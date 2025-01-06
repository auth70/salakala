import { SecretProvider } from '../SecretProvider.js';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';
import { execSync } from 'child_process';

/**
 * Provider for accessing secrets stored in Azure Key Vault.
 * Uses Azure's DefaultAzureCredential for authentication, which supports multiple authentication methods:
 * - Environment variables (AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID)
 * - Managed Identity
 * - Visual Studio Code credentials
 * - Azure CLI credentials
 * - Interactive browser login
 * 
 * @implements {SecretProvider}
 * @see {@link https://docs.microsoft.com/azure/key-vault/} for Azure Key Vault documentation
 * @see {@link https://docs.microsoft.com/javascript/api/overview/azure/identity-readme} for authentication details
 */
export class AzureKeyVaultProvider extends SecretProvider {
    /**
     * Cache of Secret Clients for different vault URLs to avoid recreating clients
     * for the same vault instance.
     */
    private clients: Map<string, SecretClient>;

    /**
     * Initializes a new AzureKeyVaultProvider with an empty client cache.
     */
    constructor() {
        super();
        this.clients = new Map();
    }

    /**
     * Gets or creates a Secret Client for the specified vault URL.
     * Uses DefaultAzureCredential for authentication.
     * 
     * @param {string} vaultUrl - The Azure Key Vault URL (e.g., https://my-vault.vault.azure.net)
     * @returns {SecretClient} A configured Azure Key Vault Secret Client instance
     * @private
     */
    private getClient(vaultUrl: string): SecretClient {
        if (!this.clients.has(vaultUrl)) {
            const credential = new DefaultAzureCredential();
            this.clients.set(vaultUrl, new SecretClient(vaultUrl, credential));
        }
        return this.clients.get(vaultUrl)!;
    }

    /**
     * Retrieves a secret value from Azure Key Vault.
     * 
     * @param {string} path - The Azure Key Vault secret reference path
     *                        Format: azurekv://vault-name.vault.azure.net/secret-name
     *                        Example: azurekv://my-vault.vault.azure.net/my-secret
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: azurekv://vault-name.vault.azure.net/secret-name
        const match = path.match(/^azurekv:\/\/([^\/]+)\/(.+)$/);
        if (!match) {
            throw new Error('Invalid Azure Key Vault path format. Expected: azurekv://vault-name.vault.azure.net/secret-name');
        }

        const [, vaultUrl, secretName] = match;
        const fullVaultUrl = `https://${vaultUrl}`;
        const client = this.getClient(fullVaultUrl);

        try {
            // Retrieve the secret from Azure Key Vault
            const response = await client.getSecret(secretName);
            
            if (!response.value) {
                throw new Error('Secret value is empty');
            }

            // Azure Key Vault returns base64 encoded strings for binary secrets automatically
            return response.value;
        } catch (error: unknown) {
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                // Check for common authentication/credentials errors
                if (errorMessage.includes('authentication failed') || 
                    errorMessage.includes('unauthorized') || 
                    errorMessage.includes('forbidden') ||
                    errorMessage.includes('credentials')) {
                    
                    // Ask if they want to authenticate with Azure
                    const response = await this.promptForAuthentication();
                    if (response) {
                        throw new Error('Please try accessing the secret again after Azure authentication is complete.');
                    }
                }
                throw new Error(`Failed to read Azure Key Vault secret: ${error.message}`);
            }
            throw new Error('Failed to read Azure Key Vault secret: Unknown error');
        }
    }

    /**
     * Prompts the user to authenticate with Azure and runs the az login command if they agree.
     * @returns {Promise<boolean>} True if authentication was attempted
     * @private
     */
    private async promptForAuthentication(): Promise<boolean> {
        try {
            console.log('\nWould you like to authenticate with Azure now? (y/N)');
            const response = await new Promise<string>((resolve) => {
                process.stdin.resume();
                process.stdin.once('data', (data) => {
                    process.stdin.pause();
                    resolve(data.toString().trim().toLowerCase());
                });
            });

            if (response === 'y' || response === 'yes') {
                console.log('\nRunning Azure authentication...');
                execSync('az login', { stdio: 'inherit' });
                return true;
            }
        } catch (error) {
            console.error('Failed to run Azure authentication command:', error);
        }
        
        return false;
    }
} 