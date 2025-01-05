import { describe, it, expect, vi } from 'vitest';
import { GoogleCloudSecretsProvider } from '../src/lib/providers/GoogleCloudSecrets.js';

// Mock SecretManagerServiceClient
vi.mock('@google-cloud/secret-manager', () => ({
    SecretManagerServiceClient: vi.fn().mockImplementation(() => ({
        accessSecretVersion: vi.fn().mockImplementation(() => Promise.resolve([]))
    }))
}));

describe('GoogleCloudSecretsProvider', () => {
    it('should retrieve string secret', async () => {
        const provider = new GoogleCloudSecretsProvider();
        const mockSecret = { payload: { data: 'secret-value' } };
        
        (provider['client'].accessSecretVersion as any).mockResolvedValue([mockSecret]);

        const secret = await provider.getSecret('gcsm://projects/test/secrets/secret/versions/1');
        expect(secret).toBe('secret-value');
    });

    it('should retrieve binary secret as base64', async () => {
        const provider = new GoogleCloudSecretsProvider();
        const binaryData = Buffer.from('test-binary-secret');
        const mockSecret = { payload: { data: binaryData } };
        
        (provider['client'].accessSecretVersion as any).mockResolvedValue([mockSecret]);

        const secret = await provider.getSecret('gcsm://projects/test/secrets/secret/versions/1');
        expect(secret).toBe(binaryData.toString('base64'));
    });

    it('should throw on invalid path', async () => {
        const provider = new GoogleCloudSecretsProvider();
        
        await expect(provider.getSecret('invalid://path'))
            .rejects
            .toThrow(/Invalid Google Cloud secret path/);
    });

    it('should handle empty payload', async () => {
        const provider = new GoogleCloudSecretsProvider();
        (provider['client'].accessSecretVersion as any).mockResolvedValue([{ payload: null }]);

        await expect(provider.getSecret('gcsm://projects/test/secrets/secret/versions/1'))
            .rejects
            .toThrow(/Secret payload is empty/);
    });

    it('should handle API errors', async () => {
        const provider = new GoogleCloudSecretsProvider();
        (provider['client'].accessSecretVersion as any).mockRejectedValue(new Error('API Error'));

        await expect(provider.getSecret('gcsm://projects/test/secrets/secret/versions/1'))
            .rejects
            .toThrow(/Failed to read Google Cloud secret/);
    });

    it('should handle JSON string secret', async () => {
        const provider = new GoogleCloudSecretsProvider();
        const jsonData = JSON.stringify({ key: 'value', nested: { data: true } });
        const mockSecret = { payload: { data: jsonData } };
        
        (provider['client'].accessSecretVersion as any).mockResolvedValue([mockSecret]);

        const secret = await provider.getSecret('gcsm://projects/test/secrets/secret/versions/1');
        expect(secret).toBe(jsonData);
        // Verify it's valid JSON
        expect(() => JSON.parse(secret)).not.toThrow();
        expect(JSON.parse(secret)).toEqual({ key: 'value', nested: { data: true } });
    });

    it('should handle JSON in buffer format', async () => {
        const provider = new GoogleCloudSecretsProvider();
        const jsonData = JSON.stringify({ key: 'value', numbers: [1, 2, 3] });
        const binaryData = Buffer.from(jsonData);
        const mockSecret = { payload: { data: binaryData } };
        
        (provider['client'].accessSecretVersion as any).mockResolvedValue([mockSecret]);

        const secret = await provider.getSecret('gcsm://projects/test/secrets/secret/versions/1');
        expect(secret).toBe(jsonData);
        // Verify it's valid JSON
        expect(() => JSON.parse(secret)).not.toThrow();
        expect(JSON.parse(secret)).toEqual({ key: 'value', numbers: [1, 2, 3] });
    });

    it('should handle non-JSON buffer as base64', async () => {
        const provider = new GoogleCloudSecretsProvider();
        const binaryData = Buffer.from('not-json-data');
        const mockSecret = { payload: { data: binaryData } };
        
        (provider['client'].accessSecretVersion as any).mockResolvedValue([mockSecret]);

        const secret = await provider.getSecret('gcsm://projects/test/secrets/secret/versions/1');
        expect(secret).toBe(binaryData.toString('base64'));
        // Verify it's not JSON
        expect(() => JSON.parse(secret)).toThrow();
    });
}); 