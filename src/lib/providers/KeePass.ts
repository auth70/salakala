import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in KeePass databases using the KeePassXC CLI.
 * This implementation requires the KeePassXC CLI (keepassxc-cli) to be installed.
 * 
 * Authentication can be handled via:
 * - Key file (configured in KeePassXC)
 * - Interactive password prompt
 * - Environment variables (if configured in KeePassXC)
 * 
 * @implements {SecretProvider}
 * @see {@link https://keepassxc.org/docs/KeePassXC_GettingStarted.html#_using_keepassxc_cli} for CLI documentation
 */
export class KeePassProvider implements SecretProvider {
    /**
     * Retrieves a secret value from a KeePass database using the KeePassXC CLI.
     * 
     * @param {string} path - The KeePass secret reference path
     *                        Format: kp://path/to/database.kdbx/entry-path
     *                        Example: kp://secrets/main.kdbx/Web/GitHub/access-token
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: kp://path/to/database.kdbx/entry-path
        if (!path.startsWith('kp://')) {
            throw new Error('Invalid KeePass secret path');
        }

        const secretPath = path.replace('kp://', '');
        const parts = secretPath.split('/');
        
        // Find the part that ends with .kdbx to separate database path from entry path
        let dbPathEndIndex = -1;
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].endsWith('.kdbx')) {
                dbPathEndIndex = i;
                break;
            }
        }

        if (dbPathEndIndex === -1 || dbPathEndIndex === parts.length - 1) {
            throw new Error('Invalid KeePass path format. Expected: kp://path/to/database.kdbx/entry-path');
        }

        // Split the path into database path and entry path components
        const dbPath = parts.slice(0, dbPathEndIndex + 1).join('/');
        const entryPath = parts.slice(dbPathEndIndex + 1).join('/');

        try {
            // First try to get the secret directly (might work if key file is configured)
            return await this.getSecretValue(dbPath, entryPath);
        } catch (error: unknown) {
            // If it fails, try with interactive password prompt
            try {
                // The CLI will prompt for password automatically with stdio: 'inherit'
                return await this.getSecretValue(dbPath, entryPath, true);
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read KeePass secret: ${retryError.message}`);
                }
                throw new Error('Failed to read KeePass secret: Unknown error');
            }
        }
    }

    /**
     * Internal helper method to execute the KeePassXC CLI command and retrieve the secret value.
     * 
     * @param {string} dbPath - Path to the KeePass database file (.kdbx)
     * @param {string} entryPath - Path to the entry within the database
     * @param {boolean} [allowPrompt=false] - Whether to allow interactive password prompt
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(dbPath: string, entryPath: string, allowPrompt: boolean = false): Promise<string> {
        // Execute the CLI command to show only the password field of the entry
        const result = execSync(`keepassxc-cli show -a Password "${dbPath}" "${entryPath}"`, {
            encoding: 'utf-8',
            // Only inherit stdin if we want to allow password prompt
            stdio: allowPrompt ? 'inherit' : ['ignore', 'pipe', 'pipe']
        });

        if (!result) {
            throw new Error(`No value found for entry '${entryPath}' in database '${dbPath}'`);
        }

        const value = result.trim();
        if (!value) {
            throw new Error(`No value found for entry '${entryPath}' in database '${dbPath}'`);
        }

        return value;
    }
} 