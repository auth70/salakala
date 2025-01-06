import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in Infisical using the Infisical CLI.
 * This implementation requires the Infisical CLI to be installed and configured.
 * 
 * The authentication state is cached after the first successful login
 * and reused for subsequent requests until the program terminates.
 * 
 * The provider supports automatic authentication via the CLI if needed.
 * Authentication can be configured via:
 * - Interactive login (infisical login)
 * - Service tokens
 * - Environment variables
 * 
 * @implements {SecretProvider}
 * @see {@link https://infisical.com/docs/cli/overview} for Infisical CLI documentation
 */
export class InfisicalProvider extends SecretProvider {
    /**
     * Flag indicating whether we have successfully authenticated in this session.
     * @private
     */
    private isAuthenticated: boolean = false;

    /**
     * Retrieves a secret value from Infisical using the CLI.
     * 
     * @param {string} path - The Infisical secret reference path
     *                        Format: inf://workspace/environment/secret-name
     *                        Example: inf://my-project/dev/DATABASE_URL
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: inf://workspace/environment/secret-name
        // Example: inf://my-project/dev/DATABASE_URL
        if (!path.startsWith('inf://')) {
            throw new Error('Invalid Infisical secret path');
        }

        const secretPath = path.substring('inf://'.length);
        const parts = secretPath.split('/');
        
        if (parts.length !== 3) {
            throw new Error('Invalid Infisical path format. Expected: inf://workspace/environment/secret-name');
        }

        const [workspace, environment, secretName] = parts;

        try {
            // Try to get the secret if we're already authenticated
            if (this.isAuthenticated) {
                return await this.getSecretValue(workspace, environment, secretName);
            }
            
            // If not authenticated, try anyway (might work if already logged in from another session)
            const result = await this.getSecretValue(workspace, environment, secretName);
            this.isAuthenticated = true;
            return result;
        } catch (error: unknown) {
            // If first attempt fails, try to authenticate and retry
            try {
                // Initiate interactive login through the CLI
                execSync('infisical login', {
                    encoding: 'utf-8',
                    stdio: 'inherit'
                });
                
                this.isAuthenticated = true;
                // Retry getting the secret after authentication
                return await this.getSecretValue(workspace, environment, secretName);
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read Infisical secret: ${retryError.message}`);
                }
                throw new Error('Failed to read Infisical secret: Unknown error');
            }
        }
    }

    /**
     * Internal helper method to execute the Infisical CLI command and retrieve the secret value.
     * 
     * @param {string} workspace - The Infisical workspace name
     * @param {string} environment - The environment name (e.g., dev, staging, prod)
     * @param {string} secretName - The name of the secret to retrieve
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(workspace: string, environment: string, secretName: string): Promise<string> {
        // Construct the CLI command to get the secret value in raw format
        const command = `infisical secrets get ${secretName} --workspace ${workspace} --environment ${environment} --raw`;

        try {
            // Execute the command and capture the output
            const result = execSync(command, {
                encoding: 'utf-8',
                stdio: ['inherit', 'pipe', 'pipe']
            });

            if (!result || !result.trim()) {
                throw new Error(`No value found for secret '${secretName}' in workspace '${workspace}' environment '${environment}'`);
            }

            return result.trim();
        } catch (error) {
            if (error instanceof Error && error.message.includes('No value found')) {
                throw error;
            }
            throw new Error(`Failed to read Infisical secret: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 