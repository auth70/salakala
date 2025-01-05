import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfisicalProvider } from '../src/lib/providers/Infisical.js';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('InfisicalProvider', () => {
    let provider: InfisicalProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new InfisicalProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid Infisical secret path');
    });

    it('should throw error for incomplete path', async () => {
        await expect(provider.getSecret('inf://workspace/environment'))
            .rejects
            .toThrow('Invalid Infisical path format');
    });

    it('should retrieve secret successfully', async () => {
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('inf://my-project/dev/API_KEY');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith(
            'infisical secrets get API_KEY --workspace my-project --environment dev --raw',
            expect.any(Object)
        );
    });

    it('should handle empty secret value', async () => {
        vi.mocked(execSync).mockReturnValueOnce('\n');

        await expect(provider.getSecret('inf://my-project/dev/API_KEY'))
            .rejects
            .toThrow('No value found for secret');
    });

    it('should attempt login on first failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not logged in');
        });
        
        // Login succeeds
        vi.mocked(execSync).mockImplementationOnce(() => '');
        
        // Second attempt succeeds
        vi.mocked(execSync).mockImplementationOnce(() => 'test-secret-value\n');

        const result = await provider.getSecret('inf://my-project/dev/API_KEY');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith('infisical login', expect.any(Object));
    });

    it('should handle login failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not logged in');
        });
        
        // Login fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Login failed');
        });

        await expect(provider.getSecret('inf://my-project/dev/API_KEY'))
            .rejects
            .toThrow('Failed to read Infisical secret: Login failed');
    });
}); 