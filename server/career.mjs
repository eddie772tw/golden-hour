import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export function profileID(key) {
  // Browser-held bearer credential. Display names and public rank IDs cannot authenticate.
  if (typeof key !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(key)) return null;
  return createHash("sha256").update(key).digest("hex");
}

export const rules = {
  smg: { source: "ar", required: 10 },
  shotgun: { source: "smg", required: 10 },
};

export class Career {
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kills (
        match TEXT NOT NULL, round INTEGER NOT NULL, elimination INTEGER NOT NULL,
        killer TEXT NOT NULL, victim TEXT NOT NULL, weapon TEXT NOT NULL, nickname TEXT NOT NULL,
        PRIMARY KEY(match, round, elimination), CHECK(killer <> victim)
      );
      CREATE INDEX IF NOT EXISTS career_kills ON kills(killer, weapon);
    `);

    this.db.exec("CREATE TABLE IF NOT EXISTS results(match TEXT, round INTEGER, player TEXT, outcome TEXT, kills INTEGER, deaths INTEGER, score INTEGER, PRIMARY KEY(match,round,player))");
    this.finish=this.db.prepare("INSERT OR IGNORE INTO results VALUES(?,?,?,?,?,?,?)");
    this.finished=this.db.prepare("SELECT count(*) AS n, count(CASE WHEN outcome='win' THEN 1 END) AS wins, count(CASE WHEN outcome='loss' THEN 1 END) AS losses, coalesce(sum(deaths),0) AS deaths, coalesce(sum(score),0) AS score FROM results WHERE player=?");
    this.insert = this.db.prepare("INSERT INTO kills VALUES(?,?,?,?,?,?,?) ON CONFLICT(match,round,elimination) DO NOTHING");
    this.counts = this.db.prepare("SELECT weapon, count(*) AS n FROM kills WHERE killer=? GROUP BY weapon");
    this.ranking = this.db.prepare(`
      WITH totals AS (SELECT killer, count(*) AS score, max(rowid) AS last FROM kills GROUP BY killer),
      ranked AS (SELECT totals.killer, kills.nickname, score, row_number() OVER (ORDER BY score DESC, totals.killer) AS rank
                 FROM totals JOIN kills ON kills.rowid=last)
      SELECT * FROM ranked WHERE rank<=20 OR killer=? ORDER BY rank
    `);
  }
  finishRound(match,round,winner,players) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for(const p of players) if(!p.bot && p.profile) {
        const outcome=winner<0?"draw":winner===p.team?"win":"loss";
        this.finish.run(match,round,p.profile,outcome,p.kills,p.deaths,p.score);
      }
      this.db.exec("COMMIT");
    } catch(error) {this.db.exec("ROLLBACK");throw error;}
  }
  migrate(old,id) {
    if(!old) throw Error("Invalid legacy key");
    this.db.exec("CREATE TABLE IF NOT EXISTS migrated(old TEXT PRIMARY KEY, account TEXT NOT NULL)");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const owner=this.db.prepare("SELECT account FROM migrated WHERE old=?").get(old);
      if(owner && owner.account!==id) throw Error("Already migrated");
      this.db.prepare("INSERT OR IGNORE INTO migrated VALUES(?,?)").run(old,id);
      if(this.db.prepare("SELECT 1 FROM kills WHERE (killer=? AND victim=?) OR (killer=? AND victim=?) LIMIT 1").get(old,id,id,old)) throw Error("Conflicting competitive identities");
      this.db.prepare("UPDATE kills SET killer=? WHERE killer=?").run(id,old);
      this.db.prepare("UPDATE kills SET victim=? WHERE victim=?").run(id,old);
      this.db.exec("COMMIT");
    } catch(error) {this.db.exec("ROLLBACK");throw error;}
  }
  record(match, round, elimination, shooter, target, weapon) {
    if (shooter.bot || target.bot || !shooter.peer || !target.peer || !shooter.profile || !target.profile ||
        shooter.profile === target.profile || shooter.team === target.team) return false;
    return this.insert.run(match,round,elimination,shooter.profile,target.profile,weapon,shooter.name).changes === 1;
  }
  progress(id) {
    const kills = Object.fromEntries(this.counts.all(id).map(row => [row.weapon,row.n]));
    const unlocked = ["ar","pistol","m200"];
    for (const [weapon, rule] of Object.entries(rules)) {
      if ((kills[rule.source] || 0) >= rule.required) unlocked.push(weapon);
    }
    return { kills, unlocked, rules };
  }
  board(id) {
    const rows = this.ranking.all(id);
    const display = row => ({rank:row.rank, nickname:row.nickname+" #"+row.killer.slice(0,6), score:row.score});
    const mine = rows.find(row => row.killer === id);
    return {list:rows.filter(row => row.rank<=20).map(display), mine:mine?{ranked:true,...display(mine)}:{ranked:false}};
  }
}
