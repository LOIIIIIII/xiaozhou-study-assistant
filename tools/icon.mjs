import {PNG} from 'pngjs';
import {writeFile,mkdir} from 'node:fs/promises';
const image=new PNG({width:1024,height:1024});
const triangle=(x,y,a,b,c)=>{const cross=(p,q)=>(x-q[0])*(p[1]-q[1])-(p[0]-q[0])*(y-q[1]);const d=[cross(a,b),cross(b,c),cross(c,a)];return !(d.some(v=>v<0)&&d.some(v=>v>0));};
for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){
 const i=(y*1024+x)*4;
 const sail=triangle(x,y,[500,220],[500,600],[275,600])||triangle(x,y,[535,285],[535,600],[725,600]);
 const hull=y>=640&&y<760&&x>205+(y-640)*.9&&x<819-(y-640)*.9;
 const wave=y>815&&y<832&&x>270&&x<754;
 const color=sail||hull||wave?[245,240,219]:[38,79,61];
 image.data[i]=color[0];image.data[i+1]=color[1];image.data[i+2]=color[2];image.data[i+3]=255;
}
await mkdir('.vendor',{recursive:true});await writeFile('.vendor/icon.png',PNG.sync.write(image));
