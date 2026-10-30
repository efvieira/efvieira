// Gera os cards de estatísticas do perfil (SVG) direto da API do GitHub, sem serviço externo.
// Uso: GITHUB_TOKEN=... node scripts/stats.mjs <usuario> <pasta-de-saida>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [login = 'efvieira', outDir = 'dist'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Defina GITHUB_TOKEN');
  process.exit(1);
}

const query = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestContributions
      contributionCalendar { totalContributions }
    }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes {
        name
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { login } }),
});
const { data, errors } = await response.json();
if (errors) {
  console.error(JSON.stringify(errors));
  process.exit(1);
}

const user = data.user;
const repos = user.repositories.nodes.filter((r) => r.name !== login);
const c = user.contributionsCollection;

// Scripts de build (mvnw.cmd, Dockerfile) não dizem nada sobre a stack; ficam fora do card.
const IGNORED = new Set(['PowerShell', 'Batchfile', 'Shell', 'Dockerfile']);

const languages = new Map();
for (const repo of repos) {
  for (const { size, node } of repo.languages.edges) {
    if (IGNORED.has(node.name)) continue;
    const current = languages.get(node.name) ?? { size: 0, color: node.color ?? '#8b949e' };
    current.size += size;
    languages.set(node.name, current);
  }
}
const totalSize = [...languages.values()].reduce((sum, l) => sum + l.size, 0) || 1;
const topLanguages = [...languages.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 6)
  .map(([name, l]) => ({ name, color: l.color, percent: (100 * l.size) / totalSize }));

const themes = {
  dark: { bg: '#0d1117', border: '#21262d', title: '#22d3ee', text: '#c9d1d9', muted: '#8b949e' },
  light: { bg: '#ffffff', border: '#d0d7de', title: '#0e7490', text: '#1f2328', muted: '#57606a' },
};

const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const number = (n) => n.toLocaleString('pt-BR');

function frame(t, width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
  <style>
    .title { font: 600 17px 'Segoe UI', Ubuntu, sans-serif; fill: ${t.title}; }
    .label { font: 400 14px 'Segoe UI', Ubuntu, sans-serif; fill: ${t.muted}; }
    .value { font: 700 14px 'Segoe UI', Ubuntu, sans-serif; fill: ${t.text}; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
  <text x="25" y="35" class="title">${escape(title)}</text>
  ${body}
</svg>`;
}

function statsCard(t) {
  const rows = [
    ['Contribuições no último ano', c.contributionCalendar.totalContributions + c.restrictedContributionsCount],
    ['Commits no último ano', c.totalCommitContributions + c.restrictedContributionsCount],
    ['Pull requests', c.totalPullRequestContributions],
    ['Repositórios públicos', repos.length],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = 70 + i * 24;
      return `<text x="25" y="${y}" class="label">${escape(label)}</text><text x="370" y="${y}" class="value" text-anchor="end">${number(value)}</text>`;
    })
    .join('\n  ');
  return frame(t, 400, 170, 'Atividade no GitHub', body);
}

function languagesCard(t) {
  const barWidth = 350;
  let x = 25;
  const bar = topLanguages
    .map((l) => {
      const w = Math.max(2, (barWidth * l.percent) / 100);
      const rect = `<rect x="${x.toFixed(1)}" y="52" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
      x += w;
      return rect;
    })
    .join('');
  const legend = topLanguages
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = 25 + col * 180;
      const ly = 92 + row * 26;
      return `<circle cx="${lx + 5}" cy="${ly - 5}" r="5" fill="${l.color}"/><text x="${lx + 16}" y="${ly}" class="label">${escape(l.name)} <tspan class="value">${l.percent.toFixed(1)}%</tspan></text>`;
    })
    .join('\n  ');
  const body = `<clipPath id="r"><rect x="25" y="52" width="${barWidth}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#r)">${bar}</g>
  ${legend}`;
  return frame(t, 400, 170, 'Linguagens mais usadas', body);
}

mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(themes)) {
  const suffix = name === 'dark' ? '-dark' : '';
  writeFileSync(join(outDir, `stats${suffix}.svg`), statsCard(t));
  writeFileSync(join(outDir, `languages${suffix}.svg`), languagesCard(t));
}
console.log(`Cards gerados em ${outDir}: ${repos.length} repositórios, ${topLanguages.map((l) => l.name).join(', ')}`);
