import React from 'react';

import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import 'highlight.js/styles/github.css'; // Import highlight.js CSS
import './MarkdownViewer.css'; // Import custom styles

/**
 * Simple markdown viewer using react-markdown package
 */
export const MarkdownViewer = ({ content, className = "" }) => {
    if (!content || typeof content !== 'string') {
        return <div className={className}>No content to display</div>;
    }

    return (
        <div className={`markdown-viewer ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                    // Custom styling for tables
                    table: ({ node, ...props }) => (
                        <table className="pf-c-table pf-m-compact" {...props} />
                    ),
                    // Custom styling for code blocks
                    code: ({ node, inline, className, children, ...props }) => {
                        if (inline) {
                            return <code className="pf-c-code" {...props}>{children}</code>;
                        }
                        return (
                            <div className="pf-c-code-block">
                                <pre className="pf-c-code-block__pre">
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                </pre>
                            </div>
                        );
                    },
                    // Style links appropriately
                    a: ({ node, children, ...props }) => (
                        <a target="_blank" rel="noopener noreferrer" {...props}>
                            {children}
                        </a>
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
};

export default MarkdownViewer;