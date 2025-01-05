import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in Bitwarden using the Bitwarden CLI (bw).
 * This implementation requires the Bitwarden CLI to be installed and configured.
 * 
 * The session key is cached after the first successful authentication
 * and reused for subsequent requests until the program terminates.
 * 
 * @implements {SecretProvider}
 * @see {@link https://bitwarden.com/help/cli/} for Bitwarden CLI documentation
 */
export class BitwardenProvider implements SecretProvider {
    /**
     * Cached session key for reuse across multiple secret retrievals.
     * @private
     */
    private sessionKey: string | null = null;

    /**
     * Retrieves a secret value from Bitwarden using the CLI.
     * 
     * @param {string} path - The Bitwarden secret reference path
     *                        Format: bw://item-id/field
     *                        Example: bw://my-secret-item/password
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, vault is locked, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: bw://item-id/field
        if (!path.startsWith('bw://')) {
            throw new Error('Invalid Bitwarden secret path');
        }

        const secretPath = path.replace('bw://', '');
        
        try {
            // Try to get the secret using cached session key if available
            if (this.sessionKey) {
                return await this.getSecretValue(secretPath, this.sessionKey);
            }
            
            // If no session key, try without it (might work if vault is already unlocked)
            return await this.getSecretValue(secretPath);
        } catch (error: unknown) {
            // If the error is about no value found, propagate it immediately
            if (error instanceof Error && error.message.includes('No value found for secret at path')) {
                throw new Error(`Failed to read Bitwarden secret: ${error.message}`);
            }

            // Otherwise, attempt to unlock vault and retry once
            try {
                // Get session key by unlocking the vault interactively
                this.sessionKey = execSync('bw unlock --raw', {
                    encoding: 'utf-8',
                    stdio: ['inherit', 'pipe', 'pipe']
                }).trim();

                // Retry with the new session key
                return await this.getSecretValue(secretPath, this.sessionKey);
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read Bitwarden secret: ${retryError.message}`);
                }
                throw new Error('Failed to read Bitwarden secret: Unknown error');
            }
        }
    }

    /**
     * Internal helper method to execute the Bitwarden CLI command and retrieve the secret value.
     * 
     * @param {string} secretPath - The Bitwarden secret path without the 'bw://' prefix
     * @param {string} [sessionKey] - Optional session key for authentication after vault unlock
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(secretPath: string, sessionKey?: string): Promise<string> {
        // Construct the CLI command, optionally including the session key
        const command = sessionKey
            ? `bw get password "${secretPath}" --session="${sessionKey}"`
            : `bw get password "${secretPath}"`;

        try {
            // Execute the command and capture the output
            // Using 'inherit' for stdin allows for interactive authentication if needed
            const result = execSync(command, {
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
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error('Failed to read Bitwarden secret: Unknown error');
        }
    }
}