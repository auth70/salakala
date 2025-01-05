import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in 1Password using the 1Password CLI (op).
 * This implementation requires the 1Password CLI to be installed and configured.
 * 
 * The session token is cached after the first successful authentication
 * and reused for subsequent requests until the program terminates.
 * 
 * @implements {SecretProvider}
 * @see {@link https://developer.1password.com/docs/cli/reference} for 1Password CLI documentation
 */
export class OnePasswordProvider implements SecretProvider {
    /**
     * Cached session token for reuse across multiple secret retrievals.
     * @private
     */
    private sessionToken: string | null = null;

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
            // Attempt to sign in and retry once
            try {
                // Get the session token by signing in
                this.sessionToken = execSync('op signin --raw', {
                    encoding: 'utf-8',
                    stdio: ['inherit', 'pipe', 'pipe']
                }).trim();

                // Retry with the new session token
                return await this.getSecretValue(path, this.sessionToken);
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read 1Password secret: ${retryError.message}`);
                }
                throw new Error('Failed to read 1Password secret: Unknown error');
            }
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

        const result = execSync(command, {
            encoding: 'utf-8',
            stdio: ['inherit', 'pipe', 'pipe']
        });

        const value = result.trim();
        if (!value) {
            throw new Error(`No value found for secret at path '${path}'`);
        }

        return value;
    }
}