# -*- coding: utf-8 -*-
# Optional authoring tool; not needed by pnpm dev/build.
# Python 3.10+: pip install numpy scipy trimesh manifold3d fast-simplification
import base64
# -*- coding: utf-8 -*-
import numpy as np,struct,json,trimesh as tm
from scipy.spatial.transform import Rotation
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
b=(ROOT/'scripts/assets/hand-posable.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);bin=b[28+n:]
dtypes={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'};sizes={'VEC3':3,'VEC4':4,'MAT4':16,'SCALAR':1,'VEC2':2}
def acc(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];return np.frombuffer(bin,dtype=dtypes[a['componentType']],count=a['count']*sizes[a['type']],offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],sizes[a['type']]).copy()
parent={c:i for i,a in enumerate(j['nodes']) for c in a.get('children',[])}
def globals(angles):
 results={}
 def go(i):
  if i in results:return results[i]
  a=j['nodes'][i];R=Rotation.from_quat(a.get('rotation',[0,0,0,1])).as_matrix()
  if a['name'] in angles:R=R@Rotation.from_rotvec([0,0,np.deg2rad(angles[a['name']])]).as_matrix()
  M=np.eye(4);M[:3,:3]=R@np.diag(a.get('scale',[1,1,1]));M[:3,3]=a.get('translation',[0,0,0]);results[i]=(go(parent[i])@M) if i in parent else M;return results[i]
 for i in range(len(j['nodes'])):go(i)
 return results
base=globals({});skin=j['skins'][0];ib=acc(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1);prim=j['meshes'][0]['primitives'][0];attrs=prim['attributes'];positions=acc(attrs['POSITION']);weights=acc(attrs['WEIGHTS_0']);joints=acc(attrs['JOINTS_0']);faces=acc(prim['indices']).reshape(-1,3)
def posed(angles):
 world=globals(angles);mats=np.array([world[node]@ib[k] for k,node in enumerate(skin['joints'])]);src=np.column_stack([positions,np.ones(len(positions))]);out=np.zeros((len(positions),3))
 for k in range(4):out+=np.einsum('nij,nj->ni',mats[joints[:,k]],src)[:,:3]*weights[:,k,None]
 return out,world

# Pose an actual CC0 anatomical hand rather than approximating fingers with posts.
angles={'index_02_r':-24,'index_03_r':-34,'middle_02_r':-30,'middle_03_r':-39,'ring_02_r':-24,'ring_03_r':-34,'pinky_01_r':-22,'pinky_02_r':-55,'pinky_03_r':-30,'thumb_02_r':-4}
out,world=posed(angles)
verts=np.column_stack([(.035-out[:,0])*2100,out[:,1]*1700-80,(-out[:,2]-.02465)*2200])
hand=tm.Trimesh(verts,faces);hand.merge_vertices();hand.update_faces(hand.nondegenerate_faces());hand.remove_unreferenced_vertices();hand.fix_normals()
def ell(c,r,sub=3):
 m=tm.creation.icosphere(subdivisions=sub);m.vertices*=r;m.vertices+=c;return m
def box(c,s):
 m=tm.creation.box(s);m.apply_translation(c);return m
def rounded(c,s,r=3):
 r=min(r,min(s)/2)
 return tm.util.concatenate([ell(np.array(c)+np.array([x,y,z])*(np.array(s)/2-r),[r]*3,2) for x in [-1,1] for y in [-1,1] for z in [-1,1]]).convex_hull
def union(ms):return tm.boolean.union(ms,engine='manifold')
def diff(a,bs):return tm.boolean.difference([a]+bs,engine='manifold')
def tube(points,r,sections=16):
 return union([tm.creation.cylinder(r,segment=[a,b],sections=sections) for a,b in zip(points[:-1],points[1:])]+[ell(p,[r]*3,1) for p in points])
# Blend the anatomical wrist into a flared organic heel, still one hand rather than a plinth.
heel=ell([0,-4,37],[92,75,65],4)
sculpt=union([hand,heel])
sculpt=diff(sculpt,[box([0,0,-100],[1000,1000,200])])
A=tm.transformations.rotation_matrix(np.deg2rad(-13),[1,0,0]);A[:3,3]=[-43,-47,62]
def phone(m):m.apply_transform(A);return m
phonecut=phone(rounded([0,0,75.5],[74.5,11,151],4))
phoneopen=phone(rounded([0,-65,83.5],[74.5,141,133],4))
casecut=rounded([42,-38,145],[46.3,23.3,130],6)
sculpt=diff(sculpt,[phonecut,phoneopen,casecut]);sculpt.fix_normals()
parts=[]
def add(n,m,c,group):
 m.fix_normals();parts.append(dict(name=n,mesh=m,color=c,group=group))
add('掌心管家',sculpt,[232,220,200],'hand')
add('iPhone 14',phone(rounded([0,0,75.35],[71.5,7.8,146.7],3.9)),[34,37,42],'phone')
add('iPhone 屏幕',phone(rounded([0,-4.1,75.35],[65.2,.4,138],.2)),[40,63,115],'phone')
add('iPhone 刘海',phone(rounded([0,-4.35,141],[28,.15,5],.075)),[15,17,22],'phone')
add('AirPods 2',rounded([42,-38,106.75],[44.3,21.3,53.5],8),[244,245,240],'case')
add('盒盖接缝',rounded([42,-38,119],[44.4,21.4,.4],.2),[164,166,161],'case')
# Earphone envelope is deliberately identified as approximate in the UI and metadata.
cx=-18;cy=-64;top=318
path=[[cx+90*np.cos(t),cy,top-84+84*np.sin(t)] for t in np.linspace(0,np.pi,60)]
add('BlackShark V2 头梁（示意）',tube(path,7.5,18),[27,30,30],'headphones')
for sign in [-1,1]:
 x=cx+sign*90
 add('耳罩 '+str(sign),ell([x,cy,243],[20,41,47],3),[31,34,34],'headphones')
 add('耳垫 '+str(sign),ell([x-sign*13,cy,243],[10,35,41],3),[48,50,49],'headphones')
 for dy in [-20,20]:add('金属支架 '+str(sign)+str(dy),tube([[x,cy+dy,272],[x,cy+dy,240]],1.5),[111,115,113],'headphones')
add('麦克风',tube([[-126,-80,223],[-142,-94,190],[-112,-110,180]],2.6),[29,32,31],'headphones')
# Unbuckled band drapes directly over the curled little finger, no separate peg.
N=72;sv=[];sf=[]
for t in np.linspace(0,1.5*np.pi,N):
 for width,scale in [(-11.27,1),(11.27,1),(-11.27,.92),(11.27,.92)]:sv.append([91+width,-25+48*scale*np.cos(t),170+48*scale*np.sin(t)])
for i in range(N-1):
 for a,b in [(0,1),(1,3),(3,2),(2,0)]:sf.extend([[4*i+a,4*(i+1)+a,4*(i+1)+b],[4*i+a,4*(i+1)+b,4*i+b]])
sf.extend([[0,2,3],[0,3,1],[4*(N-1),4*(N-1)+1,4*(N-1)+3],[4*(N-1),4*(N-1)+3,4*(N-1)+2]])
strap=tm.Trimesh(sv,sf);strap.fix_normals()
add('手环表带（解扣示意）',strap,[34,39,36],'band')
add('小米手环 10',rounded([91,-78,170],[22.54,11.8,46.57],5.5),[27,31,29],'band')
add('手环屏幕',rounded([91,-84.1,170],[18,.4,40],.2),[28,99,80],'band')
# Resolve the illustrative devices' seating into a shallow impression, not an external support.
seatcutters=[p['mesh'] for p in parts if p['group'] in ['band','headphones'] and p['mesh'].is_volume]
sculpt=diff(sculpt,seatcutters);sculpt.fix_normals();parts[0]['mesh']=sculpt
scene=tm.Scene()
for p in parts:
 p['mesh'].visual=tm.visual.ColorVisuals(p['mesh'],vertex_colors=[*p['color'],255]);scene.add_geometry(p['mesh'],node_name=p['name'],geom_name=p['name'])
O=ROOT/'.cache/studio-model';O.mkdir(parents=True,exist_ok=True)
sculpt.export(O/'hand.stl');scene.export(O/'palm-organizer.glb')
packed=[]
for p in parts:
 m=p['mesh']
 if len(m.faces)>40000:m=m.simplify_quadric_decimation(face_count=40000)
 packed.append(dict(name=p['name'],group=p['group'],color=p['color'],positions=base64.b64encode(np.array(m.vertices,dtype='<f4').tobytes()).decode(),indices=base64.b64encode(np.array(m.faces,dtype='<u2').tobytes()).decode()))
checks={}
for p in parts:
 if p['group']!='hand' and p['mesh'].is_volume:
  inter=tm.boolean.intersection([sculpt,p['mesh']],engine='manifold');checks[p['name']]=round(float(inter.volume),3) if len(inter.faces) else 0
meta=dict(name='掌心管家',units='mm',positionEncoding='float32-le',dimensions=np.round(sculpt.extents,1).tolist(),bounds=np.round(sculpt.bounds,1).tolist(),watertight=bool(sculpt.is_watertight),components=len(sculpt.split()),source='https://www.innerscene.com/tools/library/3d-parts/posable-anatomical-right-hand-f6098b4f',license='CC0-1.0',bonePoseDegrees=angles,phoneSlot=[74.5,11],phoneAngle=13,casePocket=[46.3,23.3],printReady=False,checks=checks)
(ROOT/'src/renderer/src/features/studio/assets/palm-organizer.json').write_text(json.dumps(dict(metadata=meta,meshes=packed),ensure_ascii=False,separators=(',',':')))
print(json.dumps(meta,ensure_ascii=False,indent=2),flush=True)
