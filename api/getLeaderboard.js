export default async function handler(req, res) {
  // Set CORS headers so it works locally and on Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: 'Database environment variables are missing.' });
  }

  try {
    // ZREVRANGE fetches highest scores (kills) first
    // Limit to top 25 entries. "WITHSCORES" returns members and scores interleaved
    const response = await fetch(`${url}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['ZREVRANGE', 'leaderboard', 0, 24, 'WITHSCORES'])
    });

    if (!response.ok) {
      throw new Error(`Upstash response failed with status ${response.status}`);
    }

    const data = await response.json();
    const rawResult = data.result || [];
    const scores = [];

    // Parse the interleaved array: [member1, score1, member2, score2, ...]
    for (let i = 0; i < rawResult.length; i += 2) {
      const memberStr = rawResult[i];
      const kills = parseInt(rawResult[i + 1], 10);

      try {
        const payload = JSON.parse(memberStr);
        scores.push({
          name: payload.name || 'ANONYMOUS',
          kills: kills,
          time: payload.time || 0,
          device: payload.device || 'Desktop',
          date: payload.date || Date.now()
        });
      } catch (err) {
        // Fallback for non-JSON or older entries
        scores.push({
          name: memberStr,
          kills: kills,
          time: 0,
          device: 'Desktop',
          date: Date.now()
        });
      }
    }

    return res.status(200).json({ success: true, leaderboard: scores });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
}
