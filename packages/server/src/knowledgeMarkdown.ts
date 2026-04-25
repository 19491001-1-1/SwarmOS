import type { KnowledgeEntry } from '@mini-slock/shared';

export function knowledgeEntryToMarkdown(entry: KnowledgeEntry): string {
  return [
    '---',
    `id: ${entry.id}`,
    `kind: ${entry.kind}`,
    `tags: [${entry.tags.join(', ')}]`,
    `status: ${entry.status}`,
    `sourceRefs: [${entry.sourceRefs.join(', ')}]`,
    entry.ownerAgentId ? `ownerAgentId: ${entry.ownerAgentId}` : undefined,
    entry.reviewerAgentId ? `reviewerAgentId: ${entry.reviewerAgentId}` : undefined,
    '---',
    '',
    `# ${entry.title}`,
    '',
    entry.summary,
    '',
    entry.body,
  ].filter((line) => line !== undefined).join('\n');
}

export function markdownToKnowledgeEntry(markdown: string, fallback: Omit<KnowledgeEntry, 'tags' | 'sourceRefs'>): KnowledgeEntry {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = match?.[1] ?? '';
  const body = (match?.[2] ?? markdown).trim();
  const data = Object.fromEntries(frontmatter.split('\n').map((line) => {
    const [key, ...rest] = line.split(':');
    return [key.trim(), rest.join(':').trim()];
  }).filter(([key]) => key));
  return {
    ...fallback,
    tags: parseInlineList(data.tags),
    sourceRefs: parseInlineList(data.sourceRefs),
    body,
  };
}

function parseInlineList(value?: string): string[] {
  if (!value) return [];
  return value.replace(/^\[/, '').replace(/\]$/, '').split(',').map((item) => item.trim()).filter(Boolean);
}
