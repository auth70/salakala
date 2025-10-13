import { SecretProvider, PathComponentType } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';
import { EMOJI } from '../constants.js';

/**
 * Provider for accessing secrets stored in 1Password using the 1Password CLI (op).
 * This implementation requires the 1Password CLI to be installed and configured.
 * 
 * Authentication is handled via:
 * - Service account token (OP_SERVICE_ACCOUNT_TOKEN environment variable)
 * - Session token (cached after successful authentication)
 * - Interactive signin (if neither of the above is available)
 * 
 * @implements {SecretProvider}
 * @see {@link https://developer.1password.com/docs/cli/reference} for 1Password CLI documentation
 */
export class OnePasswordProvider extends SecretProvider {
    readonly supportsMultipleFields = true;
    readonly pathComponents = [
        { name: 'vault', type: PathComponentType.Vault, description: 'Vault name', required: true },
        { name: 'item', type: PathComponentType.Item, description: 'Item name', required: true },
        { name: 'section', type: PathComponentType.Section, description: 'Section name (optional)', required: false },
    ];

    private sessionToken: string | null = null;
    private cli: CliHandler;

    constructor() {
        super();
        this.cli = new CliHandler();
        // Use service account token if available
        if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
            this.sessionToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;
        }
    }

    buildPath(components: Record<string, string>, opts?: { fieldName?: string }): string {
        const { vault, item, section } = components;
        const fieldName = opts?.fieldName || 'value';
        
        if (section) {
            return `op://${vault}/${item}/${section}/${fieldName}`;
        }
        return `op://${vault}/${item}/${fieldName}`;
    }

    /**
     * Retrieves a secret value from 1Password using the CLI.
     * 
     * @param {string} path - The 1Password secret reference path
     *                        Format: op://vault-name/item-name/[section-name/]field-name[::jsonKey]
     *                        Example: op://Development/API Keys/production/access_token
     *                        Example with JSON: op://Development/config/database::host
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: op://vault-name/item-name/[section-name/]field-name[::jsonKey]
        if (!path.startsWith('op://')) {
            throw new Error('Invalid 1Password secret path');
        }

        // Parse the path to separate the 1Password reference from any JSON key
        const parsedPath = this.parsePath(path);
        const opPath = `${parsedPath.scheme}://${parsedPath.path}`;

        try {
            // Try to get the secret using cached session token if available
            let secretValue: string;
            if (this.sessionToken) {
                secretValue = await this.getSecretValue(opPath, this.sessionToken);
            } else {
                // If no session token, try without it (might work if user is already signed in)
                secretValue = await this.getSecretValue(opPath);
            }

            // If there's a JSON key, parse and extract the value
            if (parsedPath.jsonKey) {
                return this.returnPossibleJsonValue(secretValue, parsedPath.jsonKey);
            }

            return secretValue;
        } catch (error: unknown) {
            // Only attempt interactive signin if not using service account token
            if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
                try {
                    console.log(`${EMOJI.LOGIN} 1Password needs to login. You are interacting with 1Password CLI now.`);
                    const loginResponse = await this.cli.run('op signin --raw', {
                        interactive: true,
                        passwordPrompt: 'Enter the password for',
                        suppressStdout: true,
                    });
                    if (loginResponse.state !== 'ok') {
                        throw new Error(loginResponse.error?.message || loginResponse.message || 'Unable to run op signin');
                    }
                    this.sessionToken = loginResponse.stdout.trim();

                    // Retry with the new session token
                    const secretValue = await this.getSecretValue(opPath, this.sessionToken);

                    // If there's a JSON key, parse and extract the value
                    if (parsedPath.jsonKey) {
                        return this.returnPossibleJsonValue(secretValue, parsedPath.jsonKey);
                    }

                    return secretValue;
                } catch (retryError: unknown) {
                    this.wrapProviderError(retryError, 'read', '1Password');
                }
            }
            
            // If using service account token, or other error, throw directly
            this.wrapProviderError(error, 'read', '1Password');
        }
    }

    /**
     * Internal helper method to execute the 1Password CLI command and retrieve the secret value.
     * 
     * @param {string} path - The 1Password secret path
     * @param {string} [sessionToken] - Optional session token for authentication
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(path: string, sessionToken?: string): Promise<string> {
        const command = `op read "${path}"`;
        const envVars = sessionToken ? { OP_SESSION: sessionToken } : undefined;

        const response = await this.cli.run(command, { env: envVars });
        if (response.state !== 'ok') {
            throw new Error(response.error?.message || response.message || 'Unable to read secret');
        }

        const value = response.stdout.trim();
        if (!value) {
            throw new Error(`No value found for secret at path '${path}'`);
        }

        return value;
    }

    /**
     * Stores a secret value in 1Password.
     * Creates a new item if it doesn't exist, or updates an existing field.
     * 
     * @param {string} path - The 1Password secret reference path
     *                        Format: op://vault-name/item-name/[section-name/]field-name
     *                        Example: op://Development/API Keys/production/access_token
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be written
     */
    async setSecret(path: string, value: string): Promise<void> {
        if (!path.startsWith('op://')) {
            throw new Error('Invalid 1Password secret path');
        }

        const parsedPath = this.parsePath(path);
        const pathParts = parsedPath.pathParts;

        if (pathParts.length < 2) {
            throw new Error('1Password path must include at least vault and item name');
        }

        const vaultName = pathParts[0];
        const itemName = pathParts[1];
        let fieldName: string;
        let sectionName: string | undefined;

        if (pathParts.length === 2) {
            throw new Error('1Password path must include a field name');
        } else if (pathParts.length === 3) {
            fieldName = pathParts[2];
        } else {
            sectionName = pathParts.slice(2, -1).join('.');
            fieldName = pathParts[pathParts.length - 1];
        }

        try {
            const envVars = this.sessionToken ? { OP_SESSION: this.sessionToken } : undefined;
            
            const checkCommand = `op item get "${itemName}" --vault="${vaultName}" --format=json`;
            const checkResponse = await this.cli.run(checkCommand, { env: envVars });
            
            if (checkResponse.state === 'ok') {
                const fieldPath = sectionName ? `${sectionName}.${fieldName}` : fieldName;
                const escapedValue = this.cli.escapeShellValue(value);
                const editCommand = `op item edit "${itemName}" --vault="${vaultName}" '${fieldPath}=${escapedValue}'`;

                const editResponse = await this.cli.run(editCommand, { env: envVars });
                if (editResponse.state !== 'ok') {
                    throw new Error(editResponse.error?.message || editResponse.message || 'Failed to update 1Password item');
                }
            } else {
                const escapedValue = this.cli.escapeShellValue(value);
                const fieldSpec = sectionName 
                    ? `${sectionName}.${fieldName}[password]=${escapedValue}`
                    : `${fieldName}[password]=${escapedValue}`;
                
                const createCommand = `op item create --category=login --title="${itemName}" --vault="${vaultName}" '${fieldSpec}'`;

                const createResponse = await this.cli.run(createCommand, { env: envVars });
                if (createResponse.state !== 'ok') {
                    throw new Error(createResponse.error?.message || createResponse.message || 'Failed to create 1Password item');
                }
            }
        } catch (error: unknown) {
            this.wrapProviderError(error, 'write', '1Password');
        }
    }

    /**
     * Deletes a secret from 1Password.
     * Deletes the entire item from the vault.
     * 
     * @param {string} path - The 1Password secret reference path
     *                        Format: op://vault-name/item-name/[section-name/]field-name
     *                        Example: op://Development/API Keys/production/access_token
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be deleted
     */
    async deleteSecret(path: string): Promise<void> {
        if (!path.startsWith('op://')) {
            throw new Error('Invalid 1Password secret path');
        }

        const parsedPath = this.parsePath(path);
        const pathParts = parsedPath.pathParts;

        if (pathParts.length < 2) {
            throw new Error('1Password path must include at least vault and item name');
        }

        const vaultName = pathParts[0];
        const itemName = pathParts[1];

        try {
            console.log(`${EMOJI.DELETING} Deleting 1Password item ${itemName}...`);
            const envVars = this.sessionToken ? { OP_SESSION: this.sessionToken } : undefined;
            const deleteCommand = `op item delete "${itemName}" --vault="${vaultName}"`;

            const deleteResponse = await this.cli.run(deleteCommand, { env: envVars });
            if (deleteResponse.state !== 'ok') {
                throw new Error(deleteResponse.error?.message || deleteResponse.message || 'Failed to delete 1Password item');
            }
        } catch (error: unknown) {
            this.wrapProviderError(error, 'delete', '1Password');
        }
    }
}