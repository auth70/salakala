import { execSync, spawn } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in KeePass databases using the KeePassXC CLI.
 * This implementation requires the KeePassXC CLI (keepassxc-cli) to be installed.
 * 
 * Authentication can be handled via:
 * - Key file (configured in KeePassXC)
 * - Interactive password prompt
 * - Environment variables (if configured in KeePassXC)
 * - Programmatic password input (for testing)
 * 
 * @implements {SecretProvider}
 * @see {@link https://keepassxc.org/docs/KeePassXC_GettingStarted.html#_using_keepassxc_cli} for CLI documentation
 */
export class KeePassProvider implements SecretProvider {
    private password?: string;

    constructor(password?: string) {
        this.password = password;
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

        try {
            // First try to get the secret directly (might work if key file is configured)
            return await this.getSecretValue(dbPath, entryName, attribute);
        } catch (error: unknown) {
            // If it fails, try with interactive password prompt
            try {
                // The CLI will prompt for password automatically with stdio: 'inherit'
                return await this.getSecretValue(dbPath, entryName, attribute, true);
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
     * @param {string} entryName - Name of the entry in the database
     * @param {string} attribute - The attribute to fetch (Password, UserName, etc)
     * @param {boolean} [allowPrompt=false] - Whether to allow interactive password prompt
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved
     * @private
     */
    private async getSecretValue(dbPath: string, entryName: string, attribute: string, allowPrompt: boolean = false): Promise<string> {
        try {
            // If we have a password and allowPrompt is true, use spawn for programmatic input
            if (this.password && allowPrompt) {
                return await new Promise<string>((resolve, reject) => {
                    const child = spawn('keepassxc-cli', ['show', '-a', attribute, dbPath, entryName], {
                        stdio: ['pipe', 'pipe', 'pipe']
                    });

                    let output = '';
                    let errorOutput = '';

                    child.stdout.on('data', (data) => {
                        output += data.toString();
                    });

                    child.stderr.on('data', (data) => {
                        const stderr = data.toString();
                        // Only append if it's not the password prompt
                        if (!stderr.includes('Enter password')) {
                            errorOutput += stderr;
                        }
                    });

                    child.on('close', (code) => {
                        if (code === 0) {
                            const value = output.trim();
                            if (!value) {
                                reject(new Error(`No value returned for attribute '${attribute}' in entry '${entryName}'`));
                            } else {
                                resolve(value);
                            }
                        } else {
                            if (errorOutput.includes('Could not find entry')) {
                                reject(new Error(`Entry '${entryName}' not found in database '${dbPath}'`));
                            } else {
                                reject(new Error(errorOutput || 'Failed to read KeePass secret'));
                            }
                        }
                    });

                    // Write password when prompted
                    child.stderr.on('data', (data) => {
                        if (data.toString().includes('Enter password')) {
                            child.stdin.write(this.password + '\n');
                        }
                    });
                });
            } else {
                // Use existing execSync implementation for non-password or non-interactive cases
                const result = execSync(`keepassxc-cli show -a ${attribute} "${dbPath}" "${entryName}"`, {
                    encoding: 'utf-8',
                    stdio: allowPrompt ? ['inherit', 'pipe', 'inherit'] : ['ignore', 'pipe', 'pipe']
                });

                const value = result?.trim();
                if (typeof value !== 'string' || value === '') {
                    throw new Error(`No value returned for attribute '${attribute}' in entry '${entryName}'`);
                }

                return value;
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('Could not find entry')) {
                throw new Error(`Entry '${entryName}' not found in database '${dbPath}'`);
            }
            throw error;
        }
    }
}