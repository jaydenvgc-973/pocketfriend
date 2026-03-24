import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, searchQuery } = await req.json();
    if (!characterId || !searchQuery) {
      return Response.json({ error: 'Missing characterId or searchQuery' }, { status: 400 });
    }

    // Perform web search via LLM with internet context
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Search the web for: "${searchQuery}". Return a JSON object with:
{
  "title": "Title of the top result",
  "author_source": "Author/Publication and domain",
  "summary": "2-3 sentence summary of the key findings",
  "url": "URL of the source"
}`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          author_source: { type: "string" },
          summary: { type: "string" },
          url: { type: "string" }
        }
      }
    });

    // Store the lookup
    const lookup = await base44.asServiceRole.entities.WebLookup.create({
      character_id: characterId,
      search_query: searchQuery,
      title: response.title,
      author_source: response.author_source,
      summary: response.summary,
      url: response.url,
      lookup_date: new Date().toISOString()
    });

    return Response.json({ success: true, lookup });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});