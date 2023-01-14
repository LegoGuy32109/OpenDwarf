extends Node2D
class_name Dwarf
enum direction {N, NE, E, SE, S, SW, W, NW}
enum STATES {IDLE, MINING, DRINKING, PLAYING}
var state : int = STATES.IDLE
var coordinates : Vector2i = Vector2i()
var moving : bool = false
# might have gridSize set by the game manager
var gridSize : int = 64
# time taken off from transtion cost
var agentSpeed : float = 0.3

# needs to grab Tiles group for path finding
@onready var tiles : Node2D = self.get_parent().find_child("Tiles")
# animated sprite child
#@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D

@onready var pathfinder : Pathfinder = Pathfinder.new(tiles)

func _ready():
	$StateMenu.clear()
	var index : int = 0
	for key in STATES.keys():
		$StateMenu.add_item(key, index)
		index+=1


func _process(_delta):
	match state:
		STATES.IDLE:
			if randf() < 0.25 and not moving:
				_moveToNeighbor()

func _moveToNeighbor():
	await get_tree().create_timer(randf()*10).timeout
	var neighborTiles : Array[Tile] = pathfinder.findOpenNeighbors(coordinates)
	var chosenTile : Tile = \
	neighborTiles[randi_range(0, neighborTiles.size()-1)]
	await moveTo(chosenTile.coordinates)

# handles visual movement to new location based on path from Pathfinder
func moveTo(newCoordinates : Vector2i) -> bool:
	moving = true
	
	while not newCoordinates == coordinates:
		var path : Array[Vector2i] = \
		pathfinder.findPathTo(newCoordinates, coordinates)
		
		# return false if tile not reachable
		if path.is_empty():
			moving = false
			return false
		
		var tileCoords : Vector2i = path[1]
		var nextTile : Tile = tiles.get_child(tileCoords.x).get_child(tileCoords.y)
		var singleTween = create_tween()
		var curMoveCost : float = nextTile.movementCost - agentSpeed
		if pathfinder.isDiagNeighbor(coordinates, tileCoords):
			curMoveCost *= 1.2
		# tweening world position instead of tile coordinates
		singleTween.tween_property(self, "position", nextTile.position, curMoveCost)
		await singleTween.finished
		coordinates = tileCoords

	print("Now at "+str(coordinates))
	moving = false
	return true


# Turn grid coordinates -> world/Game coordinates * gridSize
func mapToWorld(coords: Vector2i) -> Vector2:
	return Vector2(coords.x * gridSize, coords.y * gridSize)


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


func _on_state_menu_item_selected(index):
	state = index
	print("Dwarf now ", STATES.keys()[state])
