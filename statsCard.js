import nodeHtmlToImage from "node-html-to-image";

export async function generateStatsCardImage(user, member, p, reg) {
  const displayName = member?.displayName || user.username;
  const robloxTag = reg ? `@${reg.roblox_username}` : "@Unregistered";
  const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });

  const currentRxp = p.rxp || 0;
  const maxRxp = 100;
  const rxpPercent = Math.min(100, Math.max(0, (currentRxp / maxRxp) * 100));

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        body {
          width: 800px;
          height: 450px;
          background-color: #000000;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .card {
          width: 800px;
          height: 450px;
          background-color: #0b0b0b;
          border-radius: 28px;
          padding: 40px 50px;
          color: #ffffff;
          position: relative;
        }
        .header {
          display: flex;
          align-items: center;
          gap: 25px;
        }
        .avatar {
          width: 130px;
          height: 130px;
          border-radius: 50%;
          object-fit: cover;
          background-color: #222;
        }
        .user-info {
          display: flex;
          flex-direction: column;
        }
        .nickname {
          font-size: 38px;
          font-weight: 700;
          color: #ffffff;
          line-height: 1.1;
        }
        .roblox-handle {
          font-size: 20px;
          color: #a0a0a0;
          margin-top: 4px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          row-gap: 20px;
          column-gap: 40px;
          margin-top: 35px;
          margin-left: 155px;
          font-size: 24px;
          font-weight: 500;
        }
        .stat-item span {
          color: #ffffff;
        }
        .rxp-container {
          position: absolute;
          bottom: 35px;
          left: 50px;
          right: 50px;
        }
        .rxp-text {
          font-size: 22px;
          font-weight: 500;
          margin-bottom: 10px;
        }
        .progress-bar-bg {
          width: 100%;
          height: 28px;
          background-color: #161616;
          border-radius: 14px;
          overflow: hidden;
        }
        .progress-bar-fill {
          height: 100%;
          width: ${rxpPercent}%;
          background-color: #d1d1d1;
          border-radius: 14px;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <img class="avatar" src="${avatarUrl}" alt="Avatar" />
          <div class="user-info">
            <div class="nickname">${displayName}</div>
            <div class="roblox-handle">${robloxTag}</div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-item">Rank : &nbsp;&nbsp;<span>${p.rank || "Unranked"}</span></div>
          <div class="stat-item">KDA : &nbsp;&nbsp;<span>${p.kills}/${p.deaths}/${p.assists}</span></div>
          <div class="stat-item">Rating : &nbsp;&nbsp;<span>${p.rating ?? "N/A"}</span></div>
          <div class="stat-item">W/L : &nbsp;&nbsp;<span>${p.wins}/${p.losses}</span></div>
        </div>

        <div class="rxp-container">
          <div class="rxp-text">RXP : ${currentRxp}/${maxRxp}</div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill"></div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const imageBuffer = await nodeHtmlToImage({
    html: htmlContent,
    type: "png",
    puppeteerArgs: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  return imageBuffer;
}
