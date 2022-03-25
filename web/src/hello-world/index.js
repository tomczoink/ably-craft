

/* 
 * 
 *          noa hello-world example
 * 
 *  This is a bare-minimum example world, intended to be a 
 *  starting point for hacking on noa game world content.
 * 
*/



// Engine options object, and engine instantiation:
import { Engine } from 'noa-engine'
import Ably from 'ably';
import vcdiffDecoder from '@ably/vcdiff-decoder';
// or import from local filesystem when hacking locally:
// import { Engine } from '../../../noa'



var opts = {
    debug: true,
    showFPS: true,
    chunkSize: 32,
    chunkAddDistance: 1.5,
    chunkRemoveDistance: 1.7,
    // See `test` example, or noa docs/source, for more options
}
var noa = new Engine(opts)



/*
 *
 *      Registering voxel types
 * 
 *  Two step process. First you register a material, specifying the 
 *  color/texture/etc. of a given block face, then you register a 
 *  block, which specifies the materials for a given block type.
 * 
*/

// block materials (just colors for this demo)
var textureURL = null // replace that with a filename to specify textures
var brownish = [0.45, 0.36, 0.22]
var greenish = [0.1, 0.8, 0.2]
noa.registry.registerMaterial('dirt', brownish, textureURL)
noa.registry.registerMaterial('grass', greenish, textureURL)

// block types and their material names
var dirtID = noa.registry.registerBlock(1, { material: 'dirt' })
var grassID = noa.registry.registerBlock(2, { material: 'grass' })




/*
 * 
 *      World generation
 * 
 *  The world is divided into chunks, and `noa` will emit an 
 *  `worldDataNeeded` event for each chunk of data it needs.
 *  The game client should catch this, and call 
 *  `noa.world.setChunkData` whenever the world data is ready.
 *  (The latter can be done asynchronously.)
 * 
*/

// simple height map worldgen function
function getVoxelID(x, y, z) {
    if (y < -3) return dirtID
    var height = 2 * Math.sin(x / 10) + 3 * Math.cos(z / 20)
    if (y < height) return grassID
    return 0 // signifying empty space
}

 
function new_chunk(id, data, x, y, z) {
    // `id` - a unique string id for the chunk
    // `data` - an `ndarray` of voxel ID data (see: https://github.com/scijs/ndarray)
    // `x, y, z` - world coords of the corner of the chunk
    for (var i = 0; i < data.shape[0]; i++) {
        for (var j = 0; j < data.shape[1]; j++) {
            for (var k = 0; k < data.shape[2]; k++) {
                var voxelID = getVoxelID(x + i, y + j, z + k)
                data.set(j, i, k, voxelID)
            }
        }
    }
    return data
}

function make_chunk_data(input, data){
    let itter = 0;
    for (var i = 0; i < data.shape[0]; i++) {
        for (var j = 0; j < data.shape[1]; j++) {
            for (var k = 0; k < data.shape[2]; k++) {
                var voxelID = input[itter];
                data.set(k, i, j, voxelID);
                itter++;
            }
        }
    }
    return data

}

noa.world.on('worldDataNeeded', function (id, data, x, y, z) {
    // `id` - a unique string id for the chunk
    // `data` - an `ndarray` of voxel ID data (see: https://github.com/scijs/ndarray)
    // `x, y, z` - world coords of the corner of the chunk
    inbound_channel.presence.update({'chunk':id, 'x':x,'y':y,'z':z} );

    console.log(id);


    realtime.channels.get(('[?rewind=1]outbound:'+id), {params: {rewind: '1', delta: 'vcdiff' } }
        ).subscribe(msg => 
            update(id,msg,data)

        );

})

function update(id,msg,in_data){
    console.log(msg.data)
 
    var bytes = new Uint16Array(msg.data)
    console.log('array sum is now: ' + bytes.reduce((partialSum, a) => partialSum + a, 0))
  
    noa.world.setChunkData(id, make_chunk_data(bytes,in_data))

}

noa.world.on('chunkBeingRemoved', function (id, array, userData) {
    // when chunk is removed, store data for later

    realtime.channels.get(id).detach();
})



/*
 * 
 *      Create a mesh to represent the player:
 * 
*/

// get the player entity's ID and other info (position, size, ..)
var player = noa.playerEntity
var dat = noa.entities.getPositionData(player)
var w = dat.width
var h = dat.height

// add a mesh to represent the player, and scale it, etc.
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/Builders/boxBuilder'

var scene = noa.rendering.getScene()
var mesh = Mesh.CreateBox('player-mesh', 1, scene)
mesh.scaling.x = w
mesh.scaling.z = w
mesh.scaling.y = h


// add "mesh" component to the player entity
// this causes the mesh to move around in sync with the player entity
noa.entities.addComponent(player, noa.entities.names.mesh, {
    mesh: mesh,
    // offset vector is needed because noa positions are always the 
    // bottom-center of the entity, and Babylon's CreateBox gives a 
    // mesh registered at the center of the box
    offset: [0, h / 2, 0],
})



/*
 * 
 *      Minimal interactivity 
 * 
*/

// clear targeted block on on left click
noa.inputs.down.on('fire', function () {
    if (noa.targetedBlock) {
        var pos = noa.targetedBlock.position
        noa.setBlock(0, pos[0], pos[1], pos[2])
        inbound_channel.publish(user,{'block':0,'x':pos[0],'y':pos[1],'z':pos[2]})
    }
})

// place some grass on right click
noa.inputs.down.on('alt-fire', function () {
    if (noa.targetedBlock) {
        var pos = noa.targetedBlock.adjacent
        noa.setBlock(grassID, pos[0], pos[1], pos[2])
        inbound_channel.publish(user,{'block':grassID,'x':pos[0],'y':pos[1],'z':pos[2]})
    }
})

// add a key binding for "E" to do the same as alt-fire
noa.inputs.bind('alt-fire', 'E')


// each tick, consume any scroll events and use them to zoom camera
noa.on('tick', function (dt) {
    var scroll = noa.inputs.state.scrolly
    if (scroll !== 0) {
        noa.camera.zoomDistance += (scroll > 0) ? 1 : -1
        if (noa.camera.zoomDistance < 0) noa.camera.zoomDistance = 0
        if (noa.camera.zoomDistance > 10) noa.camera.zoomDistance = 10
    }
    // move_cache.push(noa.entities.getPositionData(player).position)
})

// const ID =  fetch("https://random-word-api.herokuapp.com/word?number=2&swear=0").then(response => response.json());
const user = "" + Math.random() + " " + Math.random();
const realtime = new Ably.Realtime({
    authUrl: '/auth',
    clientId: user, /* This is who you will appear as in the presence set */
    plugins: {vcdiff: vcdiffDecoder },
    closeOnUnload: true // See https://support.ably.io/solution/articles/3000059875-why-don-t-presence-members-leave-as-soon-as-i-close-a-tab-
});

/* Enter the presence set of the 'chatroom' channel */
const inbound_channel = realtime.channels.get('inbound:' + user);
const movement_channel = realtime.channels.get('movement:' + user);
inbound_channel.attach(function (err) {
    /* Every time the presence set changes, show the new set */
});
inbound_channel.attach(function (err) {
    
    
        /* Every time the presence set changes, show the new set */
 
});
inbound_channel.presence.enter(user, function (err) {
    if (err) { return console.error("Error entering presence"); }
    console.log('We are now successfully present');
});

var body = player.getPhysics(this.playerEntity).body
        body.gravityMultiplier = 0 // less floaty
        body.autoStep = opts.playerAutoStep // auto step onto blocks


let action_cache = [];
let move_cache = [];


// const timer = setInterval(() => {
//     if (my_points.length >2){
//       sendToAbly(simplify(my_points, 3, true))
//       my_points.length = 0
    
//     }
//   }, 500);
