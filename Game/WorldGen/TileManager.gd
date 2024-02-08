extends Node

# TODO get this from somewhere else
const CHUNK_SIZE := Vector2i(16, 16)

func getTile(coordinates: Vector2i) -> Tile:
	var chunkCords = (coordinates - CHUNK_SIZE / 2).snapped(CHUNK_SIZE)
	return get_node_or_null("(%s, %s)/(%s, %s)" % [chunkCords.x, chunkCords.y, coordinates.x, coordinates.y])


func findOpenNeighborTiles(coordinates: Vector2i):
	var neighborTiles: Array[Tile] = []
	for i in range(3):
		for j in range(3):
			var potentialTile: Tile =getTile(Vector2i(coordinates - Vector2i(1,1) + Vector2i(i, j))) 
			if potentialTile.traversable && Vector2i(1,1) != Vector2i(i,j):
				neighborTiles.append(potentialTile)
	return neighborTiles
