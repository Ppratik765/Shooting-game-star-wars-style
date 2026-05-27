export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: 'Database environment variables are missing.' });
  }

  try {
    const { name, score, time, device, confirmOverwrite } = req.body;

    if (!name || typeof score !== 'number') {
      return res.status(400).json({ error: 'Invalid name or score provided.' });
    }

    // Clean name
    const cleanName = name.replace(/[^a-zA-Z0-9_\-\s]/g, '').substring(0, 15).toUpperCase();
    if (cleanName.trim().length === 0) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }

    // Fetch existing entries with scores
    const checkResponse = await fetch(`${url}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['ZRANGE', 'leaderboard', 0, -1, 'WITHSCORES'])
    });

    if (!checkResponse.ok) {
      throw new Error(`Upstash check failed with status ${checkResponse.status}`);
    }

    const checkData = await checkResponse.json();
    const rawResult = checkData.result || [];
    let existingHighestScore = -1;
    const oldPayloadsToDelete = [];

    for (let i = 0; i < rawResult.length; i += 2) {
      const memberStr = rawResult[i];
      const entryScore = parseInt(rawResult[i + 1], 10);

      try {
        const payload = JSON.parse(memberStr);
        if (payload.name === cleanName) {
          if (entryScore > existingHighestScore) {
            existingHighestScore = entryScore;
          }
          oldPayloadsToDelete.push(memberStr);
        }
      } catch (err) {
        if (memberStr === cleanName) {
          if (entryScore > existingHighestScore) {
            existingHighestScore = entryScore;
          }
          oldPayloadsToDelete.push(memberStr);
        }
      }
    }

    if (oldPayloadsToDelete.length > 0) {
      if (score <= existingHighestScore) {
        return res.status(200).json({
          success: false,
          code: 'RECORD_NOT_SUPERIOR',
          existingScore: existingHighestScore,
          message: 'PILOT RECORD EXISTS AND IS SUPERIOR OR EQUAL.'
        });
      }

      if (!confirmOverwrite) {
        return res.status(200).json({
          success: false,
          code: 'REQUIRES_OVERWRITE_CONFIRMATION',
          existingScore: existingHighestScore,
          message: 'CALLSIGN REGISTERED. CONFIRM OVERWRITE.'
        });
      }
    }

    // Unique ID to allow multiple records for same name/score
    const uniqueId = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const payload = JSON.stringify({
      name: cleanName,
      time: parseFloat(time) || 0,
      device: device || 'Desktop',
      date: Date.now(),
      id: uniqueId
    });

    let bodyCommand;
    if (oldPayloadsToDelete.length > 0) {
      const commands = [];
      for (const oldPayload of oldPayloadsToDelete) {
        commands.push(['ZREM', 'leaderboard', oldPayload]);
      }
      commands.push(['ZADD', 'leaderboard', score, payload]);
      bodyCommand = commands;
    } else {
      bodyCommand = ['ZADD', 'leaderboard', score, payload];
    }

    const response = await fetch(`${url}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyCommand)
    });

    if (!response.ok) {
      throw new Error(`Upstash response failed with status ${response.status}`);
    }

    return res.status(200).json({ success: true, message: 'Score submitted successfully.' });
  } catch (error) {
    console.error('Error submitting score:', error);
    return res.status(500).json({ error: 'Failed to submit score.' });
  }
}
