class_name TileManager
extends Node
## Global coordinater of tiles in world
##
## Is interacted with to coordinate actions on tiles
## Stores tile constants like [TILE_SIZE]

const TILE_SIZE := Vector2i(64, 64)
const CHUNK_SIZE := Vector2i(16, 16)

var tileSprites := {
	"rock": load("res://Assets/Tiles/Rock.png"),
	"ground": load("res://Assets/Tiles/Ground.png"),
}

var tileEffects: Array[TileEffect] = []

@onready var tileEffectScene = preload ("res://Game/Tile/TileEffect.tscn")

## Function to return tile in scene tree, print if tile not found or chunk not loaded
## --- expects `Vector2i` of local tile coordinates or global coordinates as `Vector2`
func getTile(tileCoordinates) -> Tile:
	if tileCoordinates is Vector2:
		# assume passed in world coordinates
		tileCoordinates = Vector2i(tileCoordinates) / TILE_SIZE
	else:
		assert(
				tileCoordinates is Vector2i,
				"tileCoordinates must be Vector2i or Vector2"
		)

	var chunkCords = (tileCoordinates - CHUNK_SIZE / 2).snapped(CHUNK_SIZE)
	var tilePath = ("(%s, %s)/(%s, %s)"
			% [chunkCords.x, chunkCords.y, tileCoordinates.x, tileCoordinates.y])
	var foundTile = get_node_or_null(tilePath)
	if !foundTile:
		printerr("Tile not found at %s" % tilePath)
	return foundTile

func findOpenNeighborTiles(coordinates: Vector2i):
	var neighborTiles: Array[Tile] = []
	for i in range(3):
		for j in range(3):
			# skip tile already on
			if i == 1 and j == 1:
				continue
			var potentialTile: Tile = getTile(
					Vector2i(coordinates - Vector2i(1, 1) + Vector2i(i, j))
			)
			if (potentialTile and potentialTile.traversable):
				neighborTiles.append(potentialTile)
	return neighborTiles

func isDiagNeighbor(loc1: Vector2i, loc2: Vector2i) -> bool:
	var dx = loc2.x - loc1.x
	var dy = loc2.y - loc1.y
	if abs(dx) == abs(dy):
		return true
	return false

# TODO allow actions on tilePositions
# TODO make action type a class to contain allowable tiles action may be preformed on
## attempt to preform an action on a tile
func tileAction(action: String, creature: Creature, tile: Tile):
	if tile:
		tile.addEffect(action, creature)
	else:
		printerr("Could not find tile for '%s' action" % action)
