import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AWSSecretsManagerProvider } from '../src/lib/providers/AWSSecretsManager.js';
import { GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';

const mockGetSecretValue = vi.fn();

vi.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManager: class {
        constructor(config: { region: string }) {
            return {
                getSecretValue: mockGetSecretValue
            };
        }
    }
}));

describe('AWSSecretsManagerProvider', () => {
    beforeEach(() => {
        mockGetSecretValue.mockReset();
    });

    it('should retrieve secret with region', async () => {
        const provider = new AWSSecretsManagerProvider();
        const mockResponse: Partial<GetSecretValueCommandOutput> = {
            SecretString: 'test-secret'
        };
        mockGetSecretValue.mockResolvedValue(mockResponse);

        const secret = await provider.getSecret('awssm://us-west-2/test/secret/path');
        expect(secret).toBe('test-secret');
        expect(mockGetSecretValue).toHaveBeenCalledWith({ SecretId: 'test/secret/path' });
    });

    it('should handle binary secrets by base64 encoding them', async () => {
        const provider = new AWSSecretsManagerProvider();
        const binaryData = Buffer.from('test-binary-secret');
        const mockResponse: Partial<GetSecretValueCommandOutput> = {
            SecretBinary: binaryData
        };
        mockGetSecretValue.mockResolvedValue(mockResponse);

        const secret = await provider.getSecret('awssm://us-west-2/test/secret/path');
        expect(secret).toBe(binaryData.toString('base64'));
        expect(mockGetSecretValue).toHaveBeenCalledWith({ SecretId: 'test/secret/path' });
    });

    it('should throw on invalid URI format', async () => {
        const provider = new AWSSecretsManagerProvider();
        await expect(provider.getSecret('awssm://invalid-path'))
            .rejects
            .toThrow('Invalid AWS secret path format. Expected: awssm://region/secret-name');
    });

    it('should reuse client for same region', async () => {
        const provider = new AWSSecretsManagerProvider();
        const mockResponse: Partial<GetSecretValueCommandOutput> = {
            SecretString: 'test-secret'
        };
        mockGetSecretValue.mockResolvedValue(mockResponse);

        await provider.getSecret('awssm://us-west-2/secret1');
        await provider.getSecret('awssm://us-west-2/secret2');
        
        expect(mockGetSecretValue).toHaveBeenCalledTimes(2);
    });

    it('should throw when secret is empty', async () => {
        const provider = new AWSSecretsManagerProvider();
        const mockResponse: Partial<GetSecretValueCommandOutput> = {};
        mockGetSecretValue.mockResolvedValue(mockResponse);

        await expect(provider.getSecret('awssm://us-east-1/test/secret/path'))
            .rejects
            .toThrow('Secret value is empty');
    });

    it('should propagate AWS errors', async () => {
        const provider = new AWSSecretsManagerProvider();
        const error = new Error('AWS Error');
        mockGetSecretValue.mockRejectedValue(error);

        await expect(provider.getSecret('awssm://us-east-1/test/secret/path'))
            .rejects
            .toThrow('Failed to read AWS secret: AWS Error');
    });

    it('should handle JSON string secret', async () => {
        const provider = new AWSSecretsManagerProvider();
        const jsonData = JSON.stringify({ key: 'value', nested: { data: true } });
        const mockResponse = { SecretString: jsonData };
        
        const mockClient = {
            getSecretValue: vi.fn().mockResolvedValue(mockResponse)
        };
        provider['clients'].set('us-east-1', mockClient as any);

        const secret = await provider.getSecret('awssm://us-east-1/test/secret');
        expect(secret).toBe(jsonData);
        // Verify it's valid JSON
        expect(() => JSON.parse(secret)).not.toThrow();
        expect(JSON.parse(secret)).toEqual({ key: 'value', nested: { data: true } });
    });

    it('should handle JSON in binary format', async () => {
        const provider = new AWSSecretsManagerProvider();
        const jsonData = JSON.stringify({ key: 'value', numbers: [1, 2, 3] });
        const binaryData = Buffer.from(jsonData);
        const mockResponse = { SecretBinary: binaryData };
        
        const mockClient = {
            getSecretValue: vi.fn().mockResolvedValue(mockResponse)
        };
        provider['clients'].set('us-east-1', mockClient as any);

        const secret = await provider.getSecret('awssm://us-east-1/test/secret');
        expect(secret).toBe(jsonData);
        // Verify it's valid JSON
        expect(() => JSON.parse(secret)).not.toThrow();
        expect(JSON.parse(secret)).toEqual({ key: 'value', numbers: [1, 2, 3] });
    });

    it('should handle non-JSON binary as base64', async () => {
        const provider = new AWSSecretsManagerProvider();
        const binaryData = Buffer.from('not-json-data');
        const mockResponse = { SecretBinary: binaryData };
        
        const mockClient = {
            getSecretValue: vi.fn().mockResolvedValue(mockResponse)
        };
        provider['clients'].set('us-east-1', mockClient as any);

        const secret = await provider.getSecret('awssm://us-east-1/test/secret');
        expect(secret).toBe(binaryData.toString('base64'));
        // Verify it's not JSON
        expect(() => JSON.parse(secret)).toThrow();
    });
});
