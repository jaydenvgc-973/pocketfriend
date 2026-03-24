import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Unauthorized' }, { status: 403 });
        }

        let updatedCount = 0;
        let skip = 0;
        const limit = 100;

        while (true) {
            const messages = await base44.asServiceRole.entities.Message.list('-created_date', limit, skip);
            if (!messages || messages.length === 0) break;

            for (const message of messages) {
                if (message.content && /\[IMAGE:\s*.+?\]/i.test(message.content)) {
                    const cleanedContent = message.content.replace(/\[IMAGE:\s*.+?\]/gi, "").trim();
                    await base44.asServiceRole.entities.Message.update(message.id, { content: cleanedContent });
                    updatedCount++;
                }
            }

            if (messages.length < limit) break;
            skip += limit;
        }

        return Response.json({ success: true, updatedMessages: updatedCount });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});