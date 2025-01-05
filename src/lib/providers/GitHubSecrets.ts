import { execSync } from 'child_process';
import { SecretProvider } from '../SecretProvider.js';

/**
 * Provider for accessing secrets stored in GitHub Secrets using the GitHub CLI (gh).
 * This implementation requires the GitHub CLI to be installed and configured.
 * 
 * The authentication state is cached after the first successful login
 * and reused for subsequent requests until the program terminates.
 * 
 * @implements {SecretProvider}
 * @see {@link https://cli.github.com/} for GitHub CLI documentation
 */
export class GitHubSecretsProvider implements SecretProvider {
    /**
     * Flag to track authentication state.
     * @private
     */
    private isAuthenticated: boolean = false;

    /**
     * Retrieves a secret value from GitHub Secrets using the CLI.
     * 
     * @param {string} path - The GitHub secret reference path
     *                        Format: ghs://owner/repo/secret-name
     *                        Example: ghs://auth70/salakala/API_KEY
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: ghs://owner/repo/secret-name
        if (!path.startsWith('ghs://')) {
            throw new Error('Invalid GitHub secret path');
        }

        const secretPath = path.replace('ghs://', '');
        const parts = secretPath.split('/');

        if (parts.length !== 3) {
            throw new Error('Invalid GitHub secret path format. Expected: ghs://owner/repo/secret-name');
        }

        const [owner, repo, secretName] = parts;

        try {
            // Try to get the secret if we're already authenticated
            if (this.isAuthenticated) {
                return await this.getSecretValue(owner, repo, secretName);
            }
            
            // If not authenticated, try anyway (might work if already logged in from another session)
            const result = await this.getSecretValue(owner, repo, secretName);
            this.isAuthenticated = true;
            return result;
        } catch (error: unknown) {
            // If first attempt fails, try to authenticate and retry
            try {
                if (error instanceof Error) {
                    // Check if it's a repository access error
                    if (error.message.toLowerCase().includes('could not read repository') ||
                        error.message.toLowerCase().includes('not found') ||
                        error.message.toLowerCase().includes('no permission') ||
                        error.message.toLowerCase().includes('access denied')) {
                        throw new Error(`Failed to read GitHub secret: Repository access denied`);
                    }
                }

                // Initiate interactive login through the CLI
                execSync('gh auth login', {
                    encoding: 'utf-8',
                    stdio: 'inherit'
                });
                
                this.isAuthenticated = true;
                // Retry getting the secret after authentication
                return await this.getSecretValue(owner, repo, secretName);
            } catch (retryError: unknown) {
                if (retryError instanceof Error) {
                    throw new Error(`Failed to read GitHub secret: ${retryError.message}`);
                }
                throw new Error('Failed to read GitHub secret: Unknown error');
            }
        }
    }

    /**
     * Internal helper method to execute the GitHub CLI command and retrieve the secret value.
     * 
     * @param {string} owner - The repository owner (user or organization)
     * @param {string} repo - The repository name
     * @param {string} secretName - The name of the secret to retrieve
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the secret cannot be retrieved or the value is empty
     * @private
     */
    private async getSecretValue(owner: string, repo: string, secretName: string): Promise<string> {
        // Execute the command to get the secret value
        const command = `gh secret list -R ${owner}/${repo} --json name,value | jq -r '.[] | select(.name=="${secretName}") | .value'`;

        try {
            // Execute the command and capture the output
            const result = execSync(command, {
                encoding: 'utf-8',
                stdio: ['inherit', 'pipe', 'pipe']
            });

            if (!result) {
                throw new Error(`No value found for secret '${secretName}' in repository '${owner}/${repo}'`);
            }

            const value = result.trim();
            if (!value) {
                throw new Error(`No value found for secret '${secretName}' in repository '${owner}/${repo}'`);
            }

            return value;
        } catch (error) {
            if (error instanceof Error) {
                // Check if it's a repository access error
                if (error.message.toLowerCase().includes('could not read repository') ||
                    error.message.toLowerCase().includes('not found') ||
                    error.message.toLowerCase().includes('no permission') ||
                    error.message.toLowerCase().includes('access denied')) {
                    throw new Error(`Failed to read GitHub secret: Repository access denied`);
                }
                throw error;
            }
            throw new Error('Failed to read GitHub secret: Unknown error');
        }
    }
} 