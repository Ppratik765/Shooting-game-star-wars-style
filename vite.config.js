import { defineConfig, loadEnv } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig(({ mode }) => {
  // Load all environment variables from .env
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      wasm(),
      topLevelAwait(),
      {
        name: 'local-vercel-api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const urlPath = req.url.split('?')[0].replace(/\/$/, '');

            // 1. GET /api/getLeaderboard
            if (urlPath === '/api/getLeaderboard' || urlPath === '/api/getLeaderboard.js') {
              const dbUrl = env.UPSTASH_REDIS_REST_URL;
              const dbToken = env.UPSTASH_REDIS_REST_TOKEN;

              if (!dbUrl || !dbToken) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Database environment variables are missing.' }));
                return;
              }

              try {
                const response = await fetch(`${dbUrl}/`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${dbToken}`,
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
                    scores.push({
                      name: memberStr,
                      kills: kills,
                      time: 0,
                      device: 'Desktop',
                      date: Date.now()
                    });
                  }
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, leaderboard: scores }));
              } catch (error) {
                console.error('Error fetching leaderboard in local server:', error);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Failed to fetch leaderboard.' }));
              }
              return;
            }

            // 2. POST /api/submitScore
            if (urlPath === '/api/submitScore' || urlPath === '/api/submitScore.js') {
              if (req.method === 'POST') {
                const dbUrl = env.UPSTASH_REDIS_REST_URL;
                const dbToken = env.UPSTASH_REDIS_REST_TOKEN;

                if (!dbUrl || !dbToken) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Database environment variables are missing.' }));
                  return;
                }

                let body = '';
                req.on('data', chunk => {
                  body += chunk;
                });
                req.on('end', async () => {
                  try {
                    const { name, score, time, device, confirmOverwrite } = JSON.parse(body);

                    if (!name || typeof score !== 'number') {
                      res.statusCode = 400;
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ error: 'Invalid name or score provided.' }));
                      return;
                    }

                    const cleanName = name.replace(/[^a-zA-Z0-9_\-\s]/g, '').substring(0, 15).toUpperCase();
                    if (cleanName.trim().length === 0) {
                      res.statusCode = 400;
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ error: 'Name cannot be empty.' }));
                      return;
                    }

                    // Check for existing names and scores
                    const checkResponse = await fetch(`${dbUrl}/`, {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${dbToken}`,
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
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                          success: false,
                          code: 'RECORD_NOT_SUPERIOR',
                          existingScore: existingHighestScore,
                          message: `IDENTICAL CALLSIGN DETECTED. PILOT'S EXISTING RECORD (${existingHighestScore} KILLS) IS EQUAL OR SUPERIOR.`
                        }));
                        return;
                      }

                      if (!confirmOverwrite) {
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                          success: false,
                          code: 'REQUIRES_OVERWRITE_CONFIRMATION',
                          existingScore: existingHighestScore,
                          message: `CALLSIGN ALREADY LOGGED WITH ${existingHighestScore} KILLS. CONFIRM OVERWRITE?`
                        }));
                        return;
                      }
                    }

                    const uniqueId = Math.random().toString(36).substring(2) + Date.now().toString(36);
                    const payload = JSON.stringify({
                      name: cleanName,
                      time: parseFloat(time) || 0,
                      device: device || 'Desktop',
                      date: Date.now(),
                      id: uniqueId
                    });

                    let bodyCommand;
                    let endpoint = `${dbUrl}/`;
                    if (oldPayloadsToDelete.length > 0) {
                      const commands = [];
                      for (const oldPayload of oldPayloadsToDelete) {
                        commands.push(['ZREM', 'leaderboard', oldPayload]);
                      }
                      commands.push(['ZADD', 'leaderboard', score, payload]);
                      bodyCommand = commands;
                      endpoint = `${dbUrl}/pipeline`;
                    } else {
                      bodyCommand = ['ZADD', 'leaderboard', score, payload];
                    }

                    const response = await fetch(endpoint, {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${dbToken}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify(bodyCommand)
                    });

                    if (!response.ok) {
                      throw new Error(`Upstash response failed with status ${response.status}`);
                    }

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true, message: 'Score submitted successfully.' }));
                  } catch (error) {
                    console.error('Error submitting score in local server:', error);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Failed to submit score.' }));
                  }
                });
              } else {
                res.statusCode = 405;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Method not allowed' }));
              }
              return;
            }

            next();
          });
        }
      }
    ],
    optimizeDeps: {
      exclude: ['core-engine']
    },
    build: {
      target: 'esnext'
    }
  };
});
