import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BitwardenProvider } from '../src/lib/providers/Bitwarden.js';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('BitwardenProvider', () => {
    let provider: BitwardenProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new BitwardenProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid Bitwarden secret path');
    });

    it('should retrieve secret successfully on first try', async () => {
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('bw://item-id/field');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith(
            'bw get password "item-id/field"',
            expect.any(Object)
        );
    });

    it('should attempt unlock and retry on first failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not logged in');
        });
        
        // Unlock succeeds with session key
        vi.mocked(execSync).mockReturnValueOnce('xyz-session-token\n');
        
        // Second attempt with session key succeeds
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('bw://item-id/field');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith('bw unlock --raw', expect.any(Object));
        expect(execSync).toHaveBeenCalledWith(
            'bw get password "item-id/field" --session="xyz-session-token"',
            expect.any(Object)
        );
    });

    it('should handle empty secret value', async () => {
        // Mock execSync to return an empty string
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('No value found for secret at path');
        });

        await expect(provider.getSecret('bw://item-id/field'))
            .rejects
            .toThrow('Failed to read Bitwarden secret: No value found for secret at path');
    });

    it('should handle unlock failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not logged in');
        });
        
        // Unlock fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Invalid master password');
        });

        await expect(provider.getSecret('bw://item-id/field'))
            .rejects
            .toThrow('Failed to read Bitwarden secret: Invalid master password');
    });
}); 