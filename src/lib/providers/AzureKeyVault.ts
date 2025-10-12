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
     *                        Format: azurekv://vault-name.vault.azure.net/secret-name[::jsonKey]
     *                        Example: azurekv://my-vault.vault.azure.net/my-secret
     *                        Example with JSON: azurekv://my-vault.vault.azure.net/config::database.host
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Parse the path to separate the Azure reference from any JSON key
        const parsedPath = this.parsePath(path);
        
        // Extract vault URL and secret name from the parsed path
        const pathMatch = parsedPath.path.match(/^([^\/]+)\/(.+)$/);
        if (!pathMatch) {
            throw new Error('Invalid Azure Key Vault path format. Expected: azurekv://vault-name.vault.azure.net/secret-name[::jsonKey]');
        }

        const [, vaultUrl, secretName] = pathMatch;
        const fullVaultUrl = `https://${vaultUrl}`;
        const client = this.getClient(fullVaultUrl);

        try {
            // Retrieve the secret from Azure Key Vault
            const response = await client.getSecret(secretName);
            
            if (!response.value) {
                throw new Error('Secret value is empty');
            }

            const secretValue = response.value;

            // If there's a JSON key, parse and extract the value
            if (parsedPath.jsonKey) {
                return this.returnPossibleJsonValue(secretValue, parsedPath.jsonKey);
            }

            // Azure Key Vault returns base64 encoded strings for binary secrets automatically
            return secretValue;
        } catch (error: unknown) {
            if (error instanceof Error) {
                // If it's our own error, throw it directly
                if (error.message.includes('Key') || 
                    error.message.includes('JSON') || 
                    error.message.includes('empty')) {
                    throw error;
                }

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

    /**
     * Stores a secret value in Azure Key Vault.
     * Creates a new secret if it doesn't exist, or updates if it does.
     * Azure SDK handles both cases automatically.
     * 
     * @param {string} path - The Azure Key Vault secret reference path
     *                        Format: azurekv://vault-name.vault.azure.net/secret-name
     *                        Example: azurekv://my-vault.vault.azure.net/api-key
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be written
     */
    async setSecret(path: string, value: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        const pathMatch = parsedPath.path.match(/^([^\/]+)\/(.+)$/);
        if (!pathMatch) {
            throw new Error('Invalid Azure Key Vault path format. Expected: azurekv://vault-name.vault.azure.net/secret-name');
        }

        const [, vaultUrl, secretName] = pathMatch;
        const fullVaultUrl = `https://${vaultUrl}`;
        const client = this.getClient(fullVaultUrl);

        try {
            console.log(`📝 Setting secret ${secretName} in Azure Key Vault...`);
            await client.setSecret(secretName, value);
        } catch (error: unknown) {
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('authentication failed') || 
                    errorMessage.includes('unauthorized') || 
                    errorMessage.includes('forbidden') ||
                    errorMessage.includes('credentials')) {
                    throw new Error(`Failed to write Azure Key Vault secret: Authentication error. ${error.message}`);
                }
                throw new Error(`Failed to write Azure Key Vault secret: ${error.message}`);
            }
            throw new Error('Failed to write Azure Key Vault secret: Unknown error');
        }
    }
} 