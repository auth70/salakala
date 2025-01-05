import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in Doppler using the Doppler CLI.
 * This implementation requires the Doppler CLI to be installed and configured.
 * 
 * The authentication state is cached after the first successful login
 * and reused for subsequent requests until the program terminates.
 * 
 * The provider supports automatic authentication via the CLI if needed.
 * Authentication can be configured via:
 * - Interactive login (doppler login)
 * - Service tokens
 * - Personal tokens
 * 
 * @implements {SecretProvider}
 * @see {@link https://docs.doppler.com/docs/cli} for Doppler CLI documentation
 */
export class DopplerProvider implements SecretProvider {
    /**
     * Flag indicating whether we have successfully authenticated in this session.
     * @private
     */
    private isAuthenticated: boolean = false;

    /**
     * Retrieves a secret value from Doppler using the CLI.
     * 
     * @param {string} path - The Doppler secret reference path
     *                        Format: doppler://project/config/secret-name
     *                        Example: doppler://my-project/dev/DATABASE_URL
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: doppler://project/config/secret-name
        // Example: doppler://my-project/dev/DATABASE_URL
        if (!path.startsWith('doppler://')) {
            throw new Error('Invalid Doppler secret path');
        }

        const secretPath = path.substring('doppler://'.length);
        const parts = secretPath.split('/');
        
        if (parts.length !== 3) {
            throw new Error('Invalid Doppler path format. Expected: doppler://project/config/secret-name');
        }

        const [project, config, secretName] = parts;

        try {
            // Try to get the secret if we're already authenticated
            if (this.isAuthenticated) {
                return await this.getSecretValue(project, config, secretName);
            }
            
            // If not authenticated, try anyway (might work if already logged in from another session)
            const result = await this.getSecretValue(project, config, secretName);
            this.isAuthenticated = true;
            return result;
        } catch (error: unknown) {
            // If first attempt fails, try to authenticate and retry
            try {
                // Initiate interactive login through the CLI
                execSync('doppler login', {
                    encoding: 'utf-8',
                    stdio: 'inherit'
                });
                
                this.isAuthenticated = true;
                // Retry getting the secret after authentication
                return await this.getSecretValue(project, config, secretName);
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read Doppler secret: ${retryError.message}`);
                }
                throw new Error('Failed to read Doppler secret: Unknown error');
            }
        }
    }

    /**
     * Internal helper method to execute the Doppler CLI command and retrieve the secret value.
     * 
     * @param {string} project - The Doppler project name
     * @param {string} config - The configuration environment (e.g., dev, staging, prod)
     * @param {string} secretName - The name of the secret to retrieve
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(project: string, config: string, secretName: string): Promise<string> {
        // Construct the CLI command to get the secret value in raw format
        const command = `doppler secrets get ${secretName} --project ${project} --config ${config} --plain`;

        try {
            // Execute the command and capture the output
            const result = execSync(command, {
                encoding: 'utf-8',
                stdio: ['inherit', 'pipe', 'pipe']
            });

            if (!result || !result.trim()) {
                throw new Error(`No value found for secret '${secretName}' in project '${project}' config '${config}'`);
            }

            return result.trim();
        } catch (error) {
            if (error instanceof Error && error.message.includes('No value found')) {
                throw error;
            }
            throw new Error(`Failed to read Doppler secret: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 