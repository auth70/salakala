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
     *                        Format: kp://path/to/database.kdbx/entry-name/attribute
     *                        Example: kp:///path/to/db.kdbx/github/Password
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: kp://path/to/database.kdbx/entry-name/attribute
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

        if (dbPathEndIndex === -1 || dbPathEndIndex >= parts.length - 2) {
            throw new Error('Invalid KeePass path format. Expected: kp://path/to/database.kdbx/entry-name/attribute');
        }

        // Split the path into components
        const dbPath = parts.slice(0, dbPathEndIndex + 1).join('/');
        const entryName = parts[dbPathEndIndex + 1];
        const attribute = parts[dbPathEndIndex + 2];

        // Try with stored password first if available
        if (this.password) {
            try {
                return await this.getSecretValue(dbPath, entryName, attribute, this.password);
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
                return value;
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
            debug: true
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
}