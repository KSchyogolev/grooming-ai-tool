export function buildAdrMetadata(
  identifier: string,
  title: string,
): {
  filename: string;
  heading: string;
} {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const date = new Date().toISOString().split("T")[0] as string;
  return {
    filename: `docs/grooming/${identifier.toLowerCase()}-${slug}.md`,
    heading: `# ADR: ${title}\n\n**Issue:** [${identifier}](linear://issue/${identifier})  \n**Date:** ${date}  \n**Status:** Draft`,
  };
}
