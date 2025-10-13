/**
 * Utility functions for the import command.
 * These are extracted for testability.
 */

/**
 * Parses .env file content into key-value pairs.
 * Handles comments, quoted values, JSON values, multi-line values, and escaped characters.
 * Compatible with dotenv parsing behavior.
 * 
 * @param {string} content - Raw .env file content
 * @returns {Record<string, string>} Parsed environment variables
 */
export function parseEnvContent(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        let trimmed = line.trim();
        
        // Support leading `export KEY=...`
        if (trimmed.startsWith('export ')) {
            trimmed = trimmed.slice(7).trim();
        }

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
            i++;
            continue;
        }

        // Find the first = sign
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) {
            i++;
            continue;
        }

        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1);

        // Handle quoted values (double or single quotes)
        if (value.startsWith('"')) {
            // Double-quoted value - handle escape sequences and multi-line
            value = value.substring(1); // Remove opening quote
            let unquotedValue = '';
            let j = 0;
            let foundClosing = false;

            while (i < lines.length) {
                while (j < value.length) {
                    const char = value[j];
                    
                    if (char === '\\' && j + 1 < value.length) {
                        // Handle escape sequences
                        const nextChar = value[j + 1];
                        if (nextChar === 'n') {
                            unquotedValue += '\n';
                            j += 2;
                        } else if (nextChar === 'r') {
                            unquotedValue += '\r';
                            j += 2;
                        } else if (nextChar === 't') {
                            unquotedValue += '\t';
                            j += 2;
                        } else if (nextChar === '"' || nextChar === '\\') {
                            unquotedValue += nextChar;
                            j += 2;
                        } else {
                            unquotedValue += char;
                            j++;
                        }
                    } else if (char === '"') {
                        // Found closing quote
                        foundClosing = true;
                        break;
                    } else {
                        unquotedValue += char;
                        j++;
                    }
                }

                if (foundClosing) {
                    // Intentionally ignore any characters after the closing quote on the same line
                    break;
                }

                // Multi-line value - continue to next line
                i++;
                if (i < lines.length) {
                    unquotedValue += '\n';
                    value = lines[i];
                    j = 0;
                }
            }

            result[key] = unquotedValue;
        } else if (value.startsWith("'")) {
            // Single-quoted value - literal, no escape sequences, can be multi-line
            value = value.substring(1); // Remove opening quote
            let unquotedValue = '';
            let j = 0;
            let foundClosing = false;

            while (i < lines.length) {
                while (j < value.length) {
                    if (value[j] === "'") {
                        foundClosing = true;
                        break;
                    }
                    unquotedValue += value[j];
                    j++;
                }

                if (foundClosing) {
                    // Intentionally ignore any characters after the closing quote on the same line
                    break;
                }

                // Multi-line value - continue to next line
                i++;
                if (i < lines.length) {
                    unquotedValue += '\n';
                    value = lines[i];
                    j = 0;
                }
            }

            result[key] = unquotedValue;
        } else {
            // Unquoted value - trim and handle inline comments
            value = value.trim();
            
            // Remove inline comments (but not if # is part of the value)
            const commentIndex = value.indexOf('#');
            if (commentIndex > 0 && value[commentIndex - 1] === ' ') {
                value = value.substring(0, commentIndex).trim();
            }
            
            result[key] = value;
        }

        i++;
    }

    return result;
}

/**
 * Truncates a value for display purposes.
 * 
 * @param {string} value - The value to truncate
 * @param {number} [maxLength=60] - Maximum length before truncation
 * @returns {string} Truncated value with ellipsis if needed
 */
export function truncateValueForDisplay(value: string, maxLength: number = 60): string {
    if (value.length <= maxLength) {
        return value;
    }
    return value.substring(0, maxLength) + '...';
}

/**
 * Generates salakala configuration from import settings.
 * Uses src/dst format with empty dst for sync compatibility.
 * 
 * @param {object} opts - Configuration options
 * @param {string[]} opts.selectedVars - List of selected variable names
 * @param {Record<string, string>} opts.envVars - All environment variables
 * @param {Record<string, string>} opts.providerPaths - Map of variable name to provider path
 * @param {string} [opts.environment] - Optional environment name for nested config
 * @returns {Record<string, any>} Generated salakala configuration in src/dst format
 */
export function generateConfig(opts: {
    selectedVars: string[];
    envVars: Record<string, string>;
    providerPaths: Record<string, string>;
    environment?: string;
}): Record<string, any> {
    const srcConfig: Record<string, string> = {};

    for (const varName of opts.selectedVars) {
        srcConfig[varName] = opts.providerPaths[varName];
    }

    const config = {
        src: srcConfig,
        dst: {}
    };

    if (opts.environment) {
        return { [opts.environment]: config };
    }

    return config;
}

/**
 * Validates that all required path components are provided.
 * 
 * @param {Record<string, string>} components - Provided component values
 * @param {string[]} required - List of required component names
 * @returns {{ valid: boolean; missing: string[] }} Validation result
 */
export function validatePathComponents(
    components: Record<string, string>,
    required: string[]
): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const req of required) {
        if (!components[req] || components[req].trim() === '') {
            missing.push(req);
        }
    }

    return {
        valid: missing.length === 0,
        missing
    };
}

