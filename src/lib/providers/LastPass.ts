import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in LastPass using the LastPass CLI (lpass).
 * This implementation requires the LastPass CLI to be installed and configured.
 * 
 * The authentication state is cached after the first successful login
 * and reused for subsequent requests until the program terminates.
 * 
 * @implements {SecretProvider}
 * @see {@link https://github.com/lastpass/lastpass-cli} for LastPass CLI documentation
 */
export class LastPassProvider extends SecretProvider {
    /**
     * Flag indicating whether we have successfully authenticated in this session.
     * @private
     */
    private isAuthenticated: boolean = false;

    /**
     * Retrieves a secret value from LastPass using the CLI.
     * 
     * @param {string} path - The LastPass secret reference path
     *                        Format: lp://group/item-name[/field]
     *                        Example: lp://Development/API Keys/password
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: lp://group/item-name[/field]
        if (!path.startsWith('lp://')) {
            throw new Error('Invalid LastPass secret path');
        }

        const secretPath = path.replace('lp://', '');
        
        try {
            // Try to get the secret if we're already authenticated
            if (this.isAuthenticated) {
                return await this.getSecretValue(secretPath);
            }
            
            // If not authenticated, try anyway (might work if already logged in from another session)
            const result = await this.getSecretValue(secretPath);
            this.isAuthenticated = true;
            return result;
        } catch (error: unknown) {
            // Attempt to sign in and retry once
            try {
                // Login using the CLI with the --trust flag to remember the device
                execSync('lpass login --trust', {
                    encoding: 'utf-8',
                    stdio: 'inherit'
                });

                this.isAuthenticated = true;
                // Retry fetching the secret after successful login
                return await this.getSecretValue(secretPath);
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read LastPass secret: ${retryError.message}`);
                }
                throw new Error('Failed to read LastPass secret: Unknown error');
            }
        }
    }

    /**
     * Internal helper method to execute the LastPass CLI command and retrieve the secret value.
     * 
     * @param {string} secretPath - The LastPass secret path without the 'lp://' prefix
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(secretPath: string): Promise<string> {
        // Execute the command to show only the password field of the item
        const result = execSync(`lpass show --password "${secretPath}"`, {
            encoding: 'utf-8',
            stdio: ['inherit', 'pipe', 'pipe']
        });

        if (!result) {
            throw new Error(`No value found for secret at path '${secretPath}'`);
        }

        const value = result.trim();
        if (!value) {
            throw new Error(`No value found for secret at path '${secretPath}'`);
        }

        return value;
    }
} 