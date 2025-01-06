import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';
import { CliPasswordHandler } from '../CliPasswordHandler.js';

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
    private cliHandler: CliPasswordHandler;

    constructor(password?: string) {
        this.cliHandler = new CliPasswordHandler(password);
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
            return await this.cliHandler.execute({
                command: 'keepassxc-cli',
                args: ['show', '-a', attribute, dbPath, entryName],
                promptText: 'Enter password',
                errorHandler: (code, stdout, stderr) => {
                    if (stderr.includes('Could not find entry')) {
                        return new Error(`Entry '${entryName}' not found in database '${dbPath}'`);
                    }
                    if (stderr.includes('unknown attribute')) {
                        return new Error(stderr.trim());
                    }
                    if (code !== 0) {
                        return new Error(`Failed to read KeePass secret: ${stderr}`);
                    }
                    return undefined;
                }
            });
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error('Failed to read KeePass secret: Unknown error');
        }
    }
}