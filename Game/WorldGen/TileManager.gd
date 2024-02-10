extends Node
class_name TileManager

# TODO get this from somewhere else
const CHUNK_SIZE := Vector2i(16, 16)

func getTile(tileCoordinates: Vector2i) -> Tile:
	var chunkCords = (tileCoordinates - CHUNK_SIZE / 2).snapped(CHUNK_SIZE)
	var foundTile = get_node_or_null("(%s, %s)/(%s, %s)" % [chunkCords.x, chunkCords.y, tileCoordinates.x, tileCoordinates.y])
	if !foundTile:
		print(
			(
				"Tile not found at (%s, %s)/(%s, %s)"
				% [chunkCords.x, chunkCords.y, tileCoordinates.x, tileCoordinates.y]
			)
		)
	return foundTile


func findOpenNeighborTiles(coordinates: Vector2i):
	var neighborTiles: Array[Tile] = []
	for i in range(3):
		for j in range(3):
			var potentialTile: Tile = getTile(Vector2i(coordinates - Vector2i(1,1) + Vector2i(i, j)))
			if potentialTile && potentialTile.traversable && Vector2i(1,1) != Vector2i(i,j):
				neighborTiles.append(potentialTile)
	return neighborTiles


func isDiagNeighbor(loc1: Vector2i, loc2: Vector2i) -> bool:
	var dx = loc2.x - loc1.x
	var dy = loc2.y - loc1.y
	if abs(dx) == abs(dy):
		return true
	return false
