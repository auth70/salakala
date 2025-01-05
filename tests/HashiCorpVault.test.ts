import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HashiCorpVaultProvider } from '../src/lib/providers/HashiCorpVault.js';
import vault from 'node-vault';

vi.mock('node-vault');

describe('HashiCorpVaultProvider', () => {
    let provider: HashiCorpVaultProvider;
    let mockRead: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRead = vi.fn();
        vi.mocked(vault).mockReturnValue({
            read: mockRead
        } as any);
        provider = new HashiCorpVaultProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid Vault path format');
    });

    it('should retrieve KV v2 secret successfully', async () => {
        const mockResponse = {
            data: {
                data: {
                    password: 'test-secret-value'
                }
            }
        };
        mockRead.mockResolvedValue(mockResponse);

        const result = await provider.getSecret('hcv://vault.example.com:8200/secret/data/my-secret');
        
        expect(result).toBe('test-secret-value');
        expect(mockRead).toHaveBeenCalledWith('secret/data/my-secret');
    });

    it('should retrieve KV v1 secret successfully', async () => {
        const mockResponse = {
            data: {
                password: 'test-secret-value'
            }
        };
        mockRead.mockResolvedValue(mockResponse);

        const result = await provider.getSecret('hcv://vault.example.com:8200/secret/my-secret');
        
        expect(result).toBe('test-secret-value');
        expect(mockRead).toHaveBeenCalledWith('secret/my-secret');
    });

    it('should throw error when secret value is not found', async () => {
        const mockResponse = {
            data: {}
        };
        mockRead.mockResolvedValue(mockResponse);

        await expect(provider.getSecret('hcv://vault.example.com:8200/secret/my-secret'))
            .rejects
            .toThrow('Secret value not found or not in expected format');
    });

    it('should handle Vault API errors', async () => {
        mockRead.mockRejectedValue(new Error('Vault API error'));

        await expect(provider.getSecret('hcv://vault.example.com:8200/secret/my-secret'))
            .rejects
            .toThrow('Failed to read Vault secret: Vault API error');
    });
}); 