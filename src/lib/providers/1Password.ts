import { SecretProvider } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';

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

    /**
     * Retrieves a secret value from 1Password using the CLI.
     * 
     * @param {string} path - The 1Password secret reference path
     *                        Format: op://vault-name/item-name/[section-name/]field-name
     *                        Example: op://Development/API Keys/production/access_token
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: op://vault-name/item-name/[section-name/]field-name
        if (!path.startsWith('op://')) {
            throw new Error('Invalid 1Password secret path');
        }

        try {
            // Try to get the secret using cached session token if available
            if (this.sessionToken) {
                return await this.getSecretValue(path, this.sessionToken);
            }
            
            // If no session token, try without it (might work if user is already signed in)
            return await this.getSecretValue(path);
        } catch (error: unknown) {
            // Only attempt interactive signin if not using service account token
            if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
                try {
                    console.log('🔑 1Password needs to login. You are interacting with 1Password CLI now.');
                    const loginResponse = await this.cli.run('op signin --raw', {
                        interactive: true,
                        passwordPrompt: 'Enter the password for',
                    });
                    if (loginResponse.state !== 'ok') {
                        throw new Error(loginResponse.error?.message || loginResponse.message || 'Unable to run op signin');
                    }
                    this.sessionToken = loginResponse.stdout.trim();

                    // Retry with the new session token
                    return await this.getSecretValue(path, this.sessionToken);
                } catch (retryError: unknown) {
                    if (retryError instanceof Error) {
                        throw new Error(`Failed to read 1Password secret: ${retryError.message}`);
                    }
                    throw new Error('Failed to read 1Password secret: Unknown error');
                }
            }
            
            // If using service account token, or other error, throw directly
            if (error instanceof Error) {
                throw new Error(`Failed to read 1Password secret: ${error.message}`);
            }
            throw new Error('Failed to read 1Password secret: Unknown error');
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
        const command = sessionToken 
            ? `op read "${path}" --session="${sessionToken}"`
            : `op read "${path}"`;

        const response = await this.cli.run(command);
        if (response.state !== 'ok') {
            throw new Error(response.error?.message || response.message || 'Unable to read secret');
        }

        const value = response.stdout.trim();
        if (!value) {
            throw new Error(`No value found for secret at path '${path}'`);
        }

        return value;
    }
}