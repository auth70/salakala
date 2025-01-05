import { SecretProvider } from '../SecretProvider.js';
import vault from 'node-vault';

/**
 * Provider for accessing secrets stored in HashiCorp Vault.
 * Supports both Key/Value (KV) version 1 and version 2 secret engines.
 * Authentication is handled via environment variables.
 * 
 * Required environment variables:
 * - VAULT_ADDR: The Vault server address
 * - VAULT_TOKEN: The authentication token
 * 
 * @implements {SecretProvider}
 * @see {@link https://www.vaultproject.io/docs/secrets/kv} for Vault KV documentation
 */
export class HashiCorpVaultProvider implements SecretProvider {
    /**
     * Cache of Vault clients for different addresses to avoid recreating clients
     * for the same Vault instance.
     */
    private clients: Map<string, vault.client>;

    /**
     * Initializes a new HashiCorpVaultProvider with an empty client cache.
     */
    constructor() {
        this.clients = new Map();
    }

    /**
     * Gets or creates a Vault client for the specified address.
     * Uses environment variables for configuration.
     * 
     * @param {string} address - The Vault server address (e.g., vault.example.com:8200)
     * @returns {vault.client} A configured Vault client instance
     * @private
     */
    private getClient(address: string): vault.client {
        if (!this.clients.has(address)) {
            // Initialize with default environment variables:
            // VAULT_ADDR - Vault server address
            // VAULT_TOKEN - Authentication token
            const config: vault.VaultOptions = {
                endpoint: `https://${address}`,
            };
            this.clients.set(address, vault(config));
        }
        return this.clients.get(address)!;
    }

    /**
     * Extracts the secret path from a full path by finding the 'secret/' segment.
     * 
     * @param {string} fullPath - The full path including the secret path
     * @returns {string} The extracted secret path starting with 'secret/'
     * @throws {Error} If the path doesn't contain a 'secret/' segment
     * @private
     */
    private extractSecretPath(fullPath: string): string {
        // Remove any leading slashes and everything before the first occurrence of 'secret/'
        const secretIndex = fullPath.indexOf('secret/');
        if (secretIndex === -1) {
            throw new Error('Invalid secret path: must contain "secret/" segment');
        }
        return fullPath.substring(secretIndex);
    }

    /**
     * Retrieves a secret value from HashiCorp Vault.
     * Automatically detects and handles both KV v1 and v2 secret engines.
     * 
     * @param {string} path - The Vault secret reference path
     *                        Format: hcv://vault-address/secret/path
     *                        Example: hcv://vault.example.com:8200/secret/data/my-secret
     * @returns {Promise<string>} The secret value (first value found in the secret data)
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: hcv://vault-address/secret/path
        // Example: hcv://vault.example.com:8200/secret/data/my-secret
        const match = path.match(/^hcv:\/\/([^\/]+)\/(.+)$/);
        if (!match) {
            throw new Error('Invalid Vault path format. Expected: hcv://address/secret/path');
        }

        const [, address, fullPath] = match;
        const secretPath = this.extractSecretPath(fullPath);
        const client = this.getClient(address);

        try {
            // Handle both KV v1 and v2 secret engines based on path format
            const isKVv2 = secretPath.includes('/data/');
            let response;
            
            if (isKVv2) {
                response = await client.read(secretPath);
                // KV v2 response format: { data: { data: { key: value } } }
                if (response?.data?.data) {
                    const secretData = response.data.data;
                    // Return the first value found in the secret
                    const firstValue = Object.values(secretData)[0];
                    if (typeof firstValue === 'string') {
                        return firstValue;
                    }
                }
            } else {
                response = await client.read(secretPath);
                // KV v1 response format: { data: { key: value } }
                if (response?.data) {
                    const secretData = response.data;
                    // Return the first value found in the secret
                    const firstValue = Object.values(secretData)[0];
                    if (typeof firstValue === 'string') {
                        return firstValue;
                    }
                }
            }
            
            throw new Error('Secret value not found or not in expected format');
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Failed to read Vault secret: ${error.message}`);
            }
            throw new Error('Failed to read Vault secret: Unknown error');
        }
    }
} 