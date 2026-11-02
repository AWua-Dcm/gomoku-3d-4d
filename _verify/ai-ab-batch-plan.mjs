export function chunks(mode,games=2000,chunkGames=100,seed=200001){
  if(!['3d','4d'].includes(mode)||!Number.isInteger(games)||games<20||
    !Number.isInteger(chunkGames)||chunkGames<20||chunkGames%20||games%chunkGames)throw new Error('分块须保持配对和五种开局的完整周期');
  return Array.from({length:games/chunkGames},(_,i)=>({mode,index:i,games:chunkGames,
    seed:seed+i*(chunkGames/4)*7919,tag:'e1-'+mode+'-'+i}));
}
