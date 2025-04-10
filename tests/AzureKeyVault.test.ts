import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureKeyVaultProvider } from '../src/lib/providers/AzureKeyVault.js';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

vi.mock('@azure/keyvault-secrets');
vi.mock('@azure/identity');

describe('AzureKeyVaultProvider', () => {
    let provider: AzureKeyVaultProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AzureKeyVaultProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid Azure Key Vault path format');
    });

    it('should retrieve secret successfully', async () => {
        const mockSecret = { value: 'test-secret-value' };
        const mockGetSecret = vi.fn().mockResolvedValue(mockSecret);
        
        vi.mocked(SecretClient).mockImplementation(() => ({
            getSecret: mockGetSecret
        } as unknown as SecretClient));

        vi.mocked(DefaultAzureCredential).mockImplementation(() => ({} as any));

        const result = await provider.getSecret('azurekv://my-vault.vault.azure.net/secret-name');
        
        expect(result).toBe('test-secret-value');
        expect(mockGetSecret).toHaveBeenCalledWith('secret-name');
    });

    // Note: Azure Key Vault automatically handles binary data by returning base64 encoded strings,
    // so no additional test cases are needed for binary data handling

    it('should throw error when secret value is empty', async () => {
        const mockSecret = { value: '' };
        const mockGetSecret = vi.fn().mockResolvedValue(mockSecret);
        
        vi.mocked(SecretClient).mockImplementation(() => ({
            getSecret: mockGetSecret
        } as unknown as SecretClient));

        vi.mocked(DefaultAzureCredential).mockImplementation(() => ({} as any));

        await expect(provider.getSecret('azurekv://my-vault.vault.azure.net/secret-name'))
            .rejects
            .toThrow('Secret value is empty');
    });

    it('should handle Azure API errors', async () => {
        const mockGetSecret = vi.fn().mockRejectedValue(new Error('Azure API error'));
        
        vi.mocked(SecretClient).mockImplementation(() => ({
            getSecret: mockGetSecret
        } as unknown as SecretClient));

        vi.mocked(DefaultAzureCredential).mockImplementation(() => ({} as any));

        await expect(provider.getSecret('azurekv://my-vault.vault.azure.net/secret-name'))
            .rejects
            .toThrow('Failed to read Azure Key Vault secret: Azure API error');
    });
}); 