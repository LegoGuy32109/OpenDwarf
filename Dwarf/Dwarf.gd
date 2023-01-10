extends Node2D
class_name Dwarf
enum direction {N, NE, E, SE, S, SW, W, NW}

var coordinates : Vector2i = Vector2i()
#@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D

# might have this be set by the game manager
var gridSize : int = 64

#	 needs to grab Tiles group for path finding
@onready var tiles : Node2D = self.get_parent().find_child("Tiles")

func moveTo(newCoordinates : Vector2i):
	var tween = create_tween()
	tween.tween_property(self, "position", mapToWorld(newCoordinates), 1) 
	await tween.finished
	_findPathTo(newCoordinates)
#	findOpenNeighbors(newCoordinates)
	coordinates = newCoordinates
	print("Now at "+str(coordinates))


# Turn grid coordinates -> world/Game coordinates * gridSize
func mapToWorld(coords: Vector2i) -> Vector2:
	return Vector2(coords.x * gridSize, coords.y * gridSize)

func _findPathTo(newCoordinates : Vector2i):
	if coordinates == newCoordinates:
		return
	var queue : PriorityQueue = PriorityQueue.new()
	queue.put(coordinates, 0)
	var came_from = {}
	var cost_so_far = {}
	came_from[coordinates] = 0
	cost_so_far[coordinates] = 0

# https://www.redblobgames.com/pathfinding/a-star/introduction.html
	while not queue.queue.is_empty():
		var currentLoc : Vector2i = queue.dequeue()
		if currentLoc == newCoordinates:
			break
		for tile in findOpenNeighbors(currentLoc):
			# but current is a neighbor of next, so it's confusing
			#                                     graph.cost(current,next)
			var new_cost = cost_so_far[currentLoc] + tile.movementCost
			if not tile.coordinates in cost_so_far or \
			new_cost < cost_so_far[tile.coordinates]:
				cost_so_far[tile.coordinates] = new_cost
				queue.put(tile.coordinates, new_cost)
				came_from[tile.coordinates] = currentLoc
				


func findOpenNeighbors(currentLoc: Vector2i) -> Array[Tile]:
	print("Neighbors for "+str(currentLoc))
	var neighborTiles: Array[Tile] = []
	for i in [-1, 0, 1]:
		if currentLoc.x+i < 0 or currentLoc.x+i > tiles.get_child_count()-1:
			continue
		var currentColumn : Node2D = tiles.get_child(currentLoc.x+i)
		for j in [-1, 0, 1]:
			# the 0,0 tile is where currentLoc is
			if (i == 0 and j == 0) or currentLoc.y+j < 0 or \
			currentLoc.y+j > currentColumn.get_child_count()-1:
				continue
			var tile : Tile = currentColumn.get_child(currentLoc.y+j)
			# check impassibleness here
			if tile.tooltipText != "Rock":
				neighborTiles.append(tile)
			
	return neighborTiles

func _cellMove(dir: direction):
	match dir:
		direction.N:
			print("North")
		direction.NE:
			print("NorthEast")
		direction.E:
			print("East")
		direction.SE:
			print("SouthEast")
		direction.S:
			print("South")
		direction.SW:
			print("SouthWest")
		direction.W:
			print("West")
		direction.NW:
			print("NorthWest")
		_:
			print("Error in direction")