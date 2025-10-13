import { SecretProvider } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';

/**
 * Provider for accessing secrets stored in KeePass databases using the KeePassXC CLI.
 * This implementation requires the KeePassXC CLI (keepassxc-cli) to be installed.
 * 
 * Authentication can be handled via:
 * - Key file (configured in KeePassXC)
 * - Interactive password prompt
 * - Environment variables (KEEPASS_PASSWORD)
 * 
 * @implements {SecretProvider}
 * @see {@link https://keepassxc.org/docs/KeePassXC_GettingStarted.html#_using_keepassxc_cli} for CLI documentation
 */
export class KeePassProvider extends SecretProvider {
    private cli: CliHandler;
    private password: string | null = null;

    constructor() {
        super();
        this.cli = new CliHandler();
        // Use password from environment if available
        if (process.env.KEEPASS_PASSWORD) {
            this.password = process.env.KEEPASS_PASSWORD;
        }
    }

    /**
     * Retrieves a secret value from a KeePass database using the KeePassXC CLI.
     * 
     * @param {string} path - The KeePass secret reference path
     *                        Format: kp://path/to/database.kdbx/entry-name/attribute[::jsonKey]
     *                        Example: kp:///path/to/db.kdbx/github/Password
     *                        Example with JSON: kp:///path/to/db.kdbx/config/Notes::database.host
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Parse the path to separate the KeePass reference from any JSON key
        const parsedPath = this.parsePath(path);
        
        // Format: kp://path/to/database.kdbx/entry-name/attribute[::jsonKey]
        const secretPath = parsedPath.path;
        const parts = secretPath.split('/');
        
        // Find the part that ends with .kdbx to separate database path from entry path
        let dbPathEndIndex = -1;
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].endsWith('.kdbx')) {
                dbPathEndIndex = i;
                break;
            }
        }

        if (dbPathEndIndex === -1 || dbPathEndIndex >= parts.length - 2) {
            throw new Error('Invalid KeePass path format. Expected: kp://path/to/database.kdbx/entry-name/attribute[::jsonKey]');
        }

        // Split the path into components
        const dbPath = parts.slice(0, dbPathEndIndex + 1).join('/');
        const entryName = parts[dbPathEndIndex + 1];
        const attribute = parts[dbPathEndIndex + 2];

        let secretValue: string;

        // Try with stored password first if available
        if (this.password) {
            try {
                secretValue = await this.getSecretValue(dbPath, entryName, attribute, this.password);
            } catch (error: unknown) {
                // If using stored password, or other error, throw directly
                if (error instanceof Error) {
                    throw new Error(`Failed to read KeePass secret: ${error.message}`);
                }
                throw new Error('Failed to read KeePass secret: Unknown error');
            }
        } else {
            try {
                console.log('🔑 KeePassXC needs a password. You are interacting with KeePassXC CLI now.');
                const response = await this.cli.run(`keepassxc-cli show -a "${attribute}" "${dbPath}" "${entryName}"`, {
                    interactive: true,
                    passwordPrompt: 'Enter password to unlock'
                });
                if (response.state !== 'ok') {
                    throw new Error(response.error?.message || response.message || 'Unable to read KeePass secret');
                }
                const value = response.stdout.trim();
                if (!value) {
                    throw new Error(`No value found for entry '${entryName}' attribute '${attribute}' in database '${dbPath}'`);
                }
                secretValue = value;
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read KeePass secret: ${retryError.message}`);
                }
                throw new Error('Failed to read KeePass secret: Unknown error');
            }
        }

        // If there's a JSON key, parse and extract the value
        if (parsedPath.jsonKey) {
            return this.returnPossibleJsonValue(secretValue, parsedPath.jsonKey);
        }

        return secretValue;
    }

    /**
     * Internal helper method to execute the KeePassXC CLI command and retrieve the secret value.
     * 
     * @param {string} dbPath - Path to the KeePass database file
     * @param {string} entryName - Name of the entry to retrieve
     * @param {string} attribute - Name of the attribute to retrieve
     * @param {string} [password] - Optional password for the database
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(dbPath: string, entryName: string, attribute: string, password?: string): Promise<string> {
        const response = await this.cli.run(`keepassxc-cli show -a "${attribute}" "${dbPath}" "${entryName}"`, {
            password: password,
            passwordPrompt: 'Enter password to unlock',
        });

        if (response.state !== 'ok') {
            if (response.stderr.includes('Could not find entry')) {
                throw new Error(`Entry '${entryName}' not found in database '${dbPath}'`);
            }
            if (response.stderr.includes('unknown attribute')) {
                throw new Error(response.stderr.trim());
            }
            throw new Error(response.error?.message || response.message || 'Unable to read KeePass secret');
        }

        const value = response.stdout.trim();
        if (!value) {
            throw new Error(`No value found for entry '${entryName}' attribute '${attribute}' in database '${dbPath}'`);
        }

        return value;
    }

    /**
     * Stores a secret value in KeePass.
     * Creates a new entry if it doesn't exist, or updates an existing attribute.
     * 
     * Note: KeePassXC CLI has limited non-interactive editing support.
     * This implementation requires interactive password entry for the database.
     * 
     * @param {string} path - The KeePass secret reference path
     *                        Format: kp://path/to/database.kdbx/entry-path/attribute
     *                        Example: kp:///Users/me/secrets.kdbx/Web/GitHub/Password
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be written
     */
    async setSecret(path: string, value: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        if (parsedPath.pathParts.length < 3) {
            throw new Error('KeePass path must include database path, entry path, and attribute');
        }

        const dbPath = parsedPath.pathParts[0];
        const entryName = parsedPath.pathParts.slice(1, -1).join('/');
        const attribute = parsedPath.pathParts[parsedPath.pathParts.length - 1];

        try {
            // Check if entry exists
            const showResponse = await this.cli.run(
                `keepassxc-cli show "${dbPath}" "${entryName}"`,
                {
                    interactive: true,
                    passwordPrompt: 'Enter password to unlock',
                    env: process.env.KEEPASS_PASSWORD ? { KEEPASS_PASSWORD: process.env.KEEPASS_PASSWORD } : {}
                }
            );
            const entryExists = showResponse.state === 'ok';

            if (entryExists) {
                // Update existing entry
                console.log(`📝 Updating KeePass entry ${entryName}, attribute ${attribute}...`);
                console.log('⚠️  KeePassXC CLI requires interactive password entry for editing');
                
                // Use edit-password for Password attribute
                if (attribute === 'Password') {
                    const editResponse = await this.cli.run(
                        `keepassxc-cli edit-password "${dbPath}" "${entryName}"`,
                        {
                            interactive: true,
                            passwordPrompt: 'Enter password to unlock',
                            password: value
                        }
                    );
                    
                    if (editResponse.state !== 'ok') {
                        throw new Error(editResponse.message || 'Failed to update password');
                    }
                } else {
                    // For other attributes, we need to use set command
                    const editResponse = await this.cli.run(
                        `keepassxc-cli set "${dbPath}" "${entryName}" "${attribute}" "${value}"`,
                        {
                            interactive: true,
                            passwordPrompt: 'Enter password to unlock'
                        }
                    );
                    
                    if (editResponse.state !== 'ok') {
                        throw new Error(editResponse.message || `Failed to update attribute ${attribute}`);
                    }
                }
            } else {
                // Create new entry
                console.log(`🆕 Creating KeePass entry ${entryName}...`);
                console.log('⚠️  KeePassXC CLI requires interactive password entry for adding entries');
                
                const addResponse = await this.cli.run(
                    `keepassxc-cli add "${dbPath}" "${entryName}"`,
                    {
                        interactive: true,
                        passwordPrompt: 'Enter password to unlock',
                        password: attribute === 'Password' ? value : undefined
                    }
                );
                
                if (addResponse.state !== 'ok') {
                    throw new Error(addResponse.message || 'Failed to create entry');
                }
                
                // If attribute is not Password, set it separately
                if (attribute !== 'Password') {
                    const setResponse = await this.cli.run(
                        `keepassxc-cli set "${dbPath}" "${entryName}" "${attribute}" "${value}"`,
                        {
                            interactive: true,
                            passwordPrompt: 'Enter password to unlock'
                        }
                    );
                    
                    if (setResponse.state !== 'ok') {
                        throw new Error(setResponse.message || `Failed to set attribute ${attribute}`);
                    }
                }
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Failed to write KeePass secret: ${error.message}`);
            }
            throw new Error('Failed to write KeePass secret: Unknown error');
        }
    }

    /**
     * Deletes a secret from KeePass.
     * Deletes the entire entry from the database.
     * 
     * Note: KeePassXC CLI requires interactive password entry.
     * 
     * @param {string} path - The KeePass secret reference path
     *                        Format: kp://path/to/database.kdbx/entry-path/attribute
     *                        Example: kp:///Users/me/secrets.kdbx/Web/GitHub/Password
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be deleted
     */
    async deleteSecret(path: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        if (parsedPath.pathParts.length < 3) {
            throw new Error('KeePass path must include database path, entry path, and attribute');
        }

        const dbPath = parsedPath.pathParts[0];
        const entryName = parsedPath.pathParts.slice(1, -1).join('/');

        try {
            console.log(`🗑️  Deleting KeePass entry ${entryName}...`);
            console.log('⚠️  KeePassXC CLI requires interactive password entry for deletion');
            
            const deleteResponse = await this.cli.run(
                `keepassxc-cli rm "${dbPath}" "${entryName}"`,
                {
                    interactive: true,
                    passwordPrompt: 'Enter password to unlock'
                }
            );
            
            if (deleteResponse.state !== 'ok') {
                throw new Error(deleteResponse.message || 'Failed to delete entry');
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Failed to delete KeePass secret: ${error.message}`);
            }
            throw new Error('Failed to delete KeePass secret: Unknown error');
        }
    }
}