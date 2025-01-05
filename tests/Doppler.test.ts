import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DopplerProvider } from '../src/lib/providers/Doppler.js';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('DopplerProvider', () => {
    let provider: DopplerProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new DopplerProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid Doppler secret path');
    });

    it('should throw error for incomplete path', async () => {
        await expect(provider.getSecret('doppler://project/config'))
            .rejects
            .toThrow('Invalid Doppler path format');
    });

    it('should retrieve secret successfully', async () => {
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('doppler://my-project/dev/API_KEY');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith(
            'doppler secrets get API_KEY --project my-project --config dev --plain',
            expect.any(Object)
        );
    });

    it('should handle empty secret value', async () => {
        vi.mocked(execSync).mockReturnValueOnce('\n');

        await expect(provider.getSecret('doppler://my-project/dev/API_KEY'))
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

        const result = await provider.getSecret('doppler://my-project/dev/API_KEY');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith('doppler login', expect.any(Object));
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

        await expect(provider.getSecret('doppler://my-project/dev/API_KEY'))
            .rejects
            .toThrow('Failed to read Doppler secret: Login failed');
    });
}); 