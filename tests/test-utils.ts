/**
 * Test utilities for generating unique identifiers
 */

/**
 * Generates a unique test identifier with high entropy to avoid collisions in parallel CI runs.
 * Combines timestamp, random number, and optional prefix.
 * 
 * @param {string} prefix - Prefix for the identifier (e.g., 'test-item')
 * @returns {string} Unique identifier
 */
export function generateTestId(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `${prefix}-${timestamp}-${random}`;
}

