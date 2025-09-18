/**
 * Escapes a value to be safely used in a .env file.
 * Handles newlines, quotes, special characters, and JSON values.
 * 
 * @param {string} value - The value to escape
 * @returns {string} The escaped value
 */
export function escapeEnvValue(value: string): string {
    // Only try to parse as JSON if it looks like a JSON object or array
    if ((value.startsWith('{') && value.endsWith('}')) || 
        (value.startsWith('[') && value.endsWith(']'))) {
        try {
            // Parse and re-stringify to ensure it's compacted
            const parsed = JSON.parse(value);
            // Use single quotes for outer wrapping to avoid double escaping
            return `'${JSON.stringify(parsed)}'`;
        } catch {} // If parsing fails, treat as a regular string and escape it
    }

    // Handle as regular string
    // Quote when value contains whitespace, quotes, equals, comment start, or dollar (potential expansion)
    const needsQuotes = /[\n\r"'\s=#\$]/.test(value) || value.startsWith(' ') || value.endsWith(' ');
    
    if (needsQuotes) {
        // Escape existing double quotes and wrap in double quotes
        const escaped = value
            .replace(/"/g, '\\"')    // Escape quotes
            .replace(/\n/g, '\\n')   // Escape newlines
            .replace(/\r/g, '\\r')   // Escape carriage returns
            .replace(/\$/g, '\\$');  // Escape dollar to avoid accidental expansion
        return `"${escaped}"`;
    }
    
    return value;
} 