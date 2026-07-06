// Seed v3 — dữ liệu demo phong phú cho Dashboard/Thống kê/Tài chính
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/fusion" });
await c.connect();

const uid = async (email, name, role, team) =>
  (await c.query(`INSERT INTO users (full_name,email,password_hash,role,team,status)
    SELECT $2,$1,(SELECT password_hash FROM users LIMIT 1),$3,$4,'active'
    ON CONFLICT (email) DO UPDATE SET team=EXCLUDED.team RETURNING id`, [email, name, role, team])).rows[0].id;

const tri = await uid("tri@fusion.co","Minh Trí","seller","Team 1");
const ha  = await uid("ha@fusion.co","Thu Hà","seller","Team 2");
const lan = await uid("lan@fusion.co","Lan Phương","seller","Team 3");
const anh = await uid("anh@fusion.co","Ngọc Ánh","designer","Team 1");
const quy = await uid("quy@fusion.co","Quý Nguyễn","designer","Team 2");
const quang = await uid("quang@fusion.co","Thiên Quang","designer","Team 3");
const admin = (await c.query(`SELECT id FROM users WHERE role='admin' LIMIT 1`)).rows[0].id;

// restrictions cho seller mới
for (const s of [lan]) for (const k of ["own_orders_only","hide_profit"])
  await c.query(`INSERT INTO user_restrictions (user_id,restriction_key,enabled) VALUES ($1,$2,true) ON CONFLICT DO NOTHING`,[s,k]);

const store = async (name, mk, seller, method) =>
  (await c.query(`INSERT INTO stores (name,marketplace,seller_id,connect_method,status,health)
    SELECT $1,$2,$3,$4,'active',$5 WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name=$1)
    RETURNING id`, [name, mk, seller, method, JSON.stringify(mk==='tiktok'?{score:96}:mk==='amazon'?{ahr:212}:{rating:4.9})])).rows[0]?.id
  ?? (await c.query(`SELECT id FROM stores WHERE name=$1`,[name])).rows[0].id;

const st1 = await store("gymwear.us","tiktok",tri,"api");
const st2 = await store("USPrime01","amazon",ha,"extension");
const st3 = await store("CozyCraftShop","etsy",lan,"extension");
const st4 = await store("fitlife.store","tiktok",tri,"api");

const gm = (await c.query(`SELECT id FROM fulfillers WHERE name='Gearment'`)).rows[0].id;
// mapping thêm vài SKU
const maps = [["TEE-GYM-L-BLK","T-Shirt","L/Black","G-TEE-5000-L-BK",5.8,3.0],
  ["TEE-GYM-M-WHT","T-Shirt","M/White","G-TEE-5000-M-WH",5.8,3.0],
  ["HOD-FIT-L-NVY","Hoodie","L/Navy","G-HOD-18500-L-NV",12.5,4.2],
  ["MUG-DOG-15","Mug","15oz","G-MUG-15OZ",4.2,2.8]];
for (const m of maps) await c.query(
  `INSERT INTO sku_mappings (internal_sku,product_type,variant,fulfiller_id,fulfiller_sku,base_cost,ship_cost)
   VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (internal_sku,fulfiller_id) DO NOTHING`,[m[0],m[1],m[2],gm,m[3],m[4],m[5]]);

// ---- Designs: 28 cái trong 7 ngày, 3 designer ----
const titles = ["gym_rat_era","dog_dad_club","plant_mom_vibes","retro_sunset_run","coffee_then_cardio","leg_day_survivor","cat_lover_tee","vintage_fishing","mama_bear_fall","hustle_quietly","beach_bum_life","protein_powered","desk_warrior","sunday_reset","midwest_princess","gains_o_clock","book_club_rebel","taco_tuesday_fan","trail_junkie","cold_brew_soul","zen_but_loud","garage_gym_og","pumpkin_spice_szn","wanderlust_van","dad_bod_energy","kettlebell_kult","yoga_and_pizza","night_owl_lift"];
const designers=[anh,anh,quy,quang]; // Ánh năng suất gấp đôi
const designIds=[];
for (let i=0;i<titles.length;i++){
  const day = i % 7, dz = designers[i % designers.length], pts = [1,1,2,2,3][i%5];
  const r = await c.query(
    `INSERT INTO designs (title,seller_id,designer_id,platform,points,listed,created_at)
     SELECT $1,$2,$3,$4,$5,true,NOW()-($6||' days')::interval - (random()*8||' hours')::interval
     WHERE NOT EXISTS (SELECT 1 FROM designs WHERE title=$1) RETURNING id`,
    [titles[i],[tri,ha,lan][i%3],dz,["tiktok","amazon","etsy"][i%3],pts,day]);
  if (r.rows[0]) designIds.push({id:r.rows[0].id, dz});
}

// ---- Reviews cho ~20 design ----
for (let i=0;i<Math.min(20,designIds.length);i++){
  const d=designIds[i];
  const sb=7+Math.floor(Math.random()*3), sa=6+Math.floor(Math.random()*4), st=7+Math.floor(Math.random()*3);
  const q=((sb+sa+st)/3);
  await c.query(
    `INSERT INTO design_reviews (design_id,reviewer_id,score_brief,score_aesthetic,score_technical,quality_score,discipline_score,business_score,total_score,decision,comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approve','seed review')`,
    [d.id,admin,sb,sa,st,q.toFixed(2),(7+Math.random()*2.5).toFixed(2),(5+Math.random()*4).toFixed(2),(q*0.3+8*0.4+7*0.3).toFixed(2)]);
}

// ---- Orders: ~70 đơn 7 ngày, 3 seller ----
const first=["Alicia","Marcus","Sarah","James","Emma","Liam","Olivia","Noah","Ava","Ethan","Mia","Lucas"];
const last=["Bennett","Cole","Miller","Parker","Wilson","Brooks","Reed","Hayes","Foster","Griffin"];
const cities=[["Austin","Texas","78701"],["Columbus","Ohio","43004"],["Miami","Florida","33139"],["Denver","Colorado","80014"],["Seattle","Washington","98101"]];
const products=[["Gym Rat Era Tee","TEE-GYM-L-BLK",24.99],["Coffee Then Cardio Tee","TEE-GYM-M-WHT",22.99],["FitLife Hoodie","HOD-FIT-L-NVY",39.99],["Dog Dad Mug","MUG-DOG-15",19.95]];
const sellers=[[tri,st1,"tiktok"],[tri,st4,"tiktok"],[ha,st2,"amazon"],[lan,st3,"etsy"]];
let created=0;
for (let day=6;day>=0;day--){
  const perDay = 6+Math.floor(Math.random()*7)+(6-day); // tăng dần về hôm nay
  for (let k=0;k<perDay;k++){
    const [sid,stid,plat]=sellers[Math.floor(Math.random()*sellers.length)];
    const p=products[Math.floor(Math.random()*products.length)];
    const ct=cities[Math.floor(Math.random()*cities.length)];
    const qty=1+(Math.random()<0.2?1:0);
    const total=(p[2]*qty).toFixed(2);
    const ext = plat==='amazon' ? `11${day}-${String(Math.floor(Math.random()*9e6)+1e6)}-${String(Math.floor(Math.random()*9e6)+1e6)}`
      : String(577460000000000000n + BigInt(Math.floor(Math.random()*9e9)));
    const status = day>=4?(Math.random()<0.7?'completed':'shipped'):day>=2?(Math.random()<0.6?'shipped':'created'):(Math.random()<0.5?'new':'created');
    const r=await c.query(
      `INSERT INTO orders (external_id,platform,source,store_id,seller_id,status,buyer_first,buyer_last,addr1,city,state,zip,total,platform_fee,ordered_at)
       VALUES ($1,$2,'api',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()-($14||' days')::interval-(random()*10||' hours')::interval)
       ON CONFLICT (platform,external_id) DO NOTHING RETURNING id,ordered_at`,
      [ext,plat,stid,sid,status,first[Math.floor(Math.random()*first.length)],last[Math.floor(Math.random()*last.length)],
       `${100+Math.floor(Math.random()*900)} Main St`,ct[0],ct[1],ct[2],total,(total*0.08).toFixed(2),day]);
    if(!r.rows[0]) continue;
    created++;
    const dz = designIds.length? designIds[Math.floor(Math.random()*designIds.length)].id : null;
    await c.query(`INSERT INTO order_items (order_id,product_title,internal_sku,qty,unit_price,design_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.rows[0].id,p[0],p[1],qty,p[2],dz]);
    // transactions: revenue cho đơn shipped/completed + base_cost
    if(['shipped','completed'].includes(status)){
      await c.query(`INSERT INTO transactions (type,amount,order_id,store_id,seller_id,occurred_at,note) VALUES ('revenue',$1,$2,$3,$4,(NOW()-($5||' days')::interval)::date,'order revenue')`,
        [total,r.rows[0].id,stid,sid,day]);
      await c.query(`INSERT INTO transactions (type,amount,order_id,store_id,seller_id,occurred_at,note) VALUES ('base_cost',$1,$2,$3,$4,(NOW()-($5||' days')::interval)::date,'Gearment')`,
        [(-(5.8+3.0)*qty).toFixed(2),r.rows[0].id,stid,sid,day]);
      await c.query(`INSERT INTO transactions (type,amount,order_id,store_id,seller_id,occurred_at,note) VALUES ('platform_fee',$1,$2,$3,$4,(NOW()-($5||' days')::interval)::date,$6)`,
        [(-(total*0.08)).toFixed(2),r.rows[0].id,stid,sid,day,plat+' fee']);
    }
  }
}
// chi phí chung
for (let day=6;day>=0;day--){
  await c.query(`INSERT INTO transactions (type,amount,occurred_at,note) VALUES ('ads',$1,(NOW()-($2||' days')::interval)::date,'TikTok Ads')`,[-(30+Math.random()*40).toFixed(2),day]);
}
await c.query(`INSERT INTO transactions (type,amount,occurred_at,note) SELECT 'tool',-89.00,date_trunc('month',NOW())::date,'Tools tháng này' WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE type='tool')`);

console.log(`✅ Seed demo: +${created} đơn 7 ngày · 28 designs · 20 reviews · transactions đầy đủ · 4 stores · 3 seller · 3 designer`);
await c.end();
