extends Node2D
class_name Dwarf

enum Actions {IDLE, MINING, MOVING}
enum Jobs {NOTHING, MINING}

var job : int = Jobs.NOTHING
var currentAction : int = Actions.IDLE
var coordinates : Vector2i = Vector2i()

# might have gridSize set by the game manager
var gridSize : int = 64
# 1.0 default, multipies time taken to move over tiles
var agentSpeed : float = 1.0

# Communicate with world node
@onready var world : Node2D = self.get_parent().get_parent()
# needs to grab Tiles group for path finding
@onready var tiles : TileParent = world.find_child("Tiles")
# animated sprite child
@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D
@onready 
var commandNode: PackedScene = load("res://_debug/CommandNode.tscn")

@onready var pathfinder : Pathfinder = world.pathfinder
@onready var sitesToMine : SitesToMine = world.sitesToMine

var commandQueue: CommandQueue = CommandQueue.new(self)

var tooltipText: String = ""

func _ready():
	agentSpeed = RandomNumberGenerator.new().randi_range(85, 120)/100.0
	tooltipText = name+"\nSpeed: "+str(agentSpeed)

func _process(_delta):
	if HUD.tileTooltipsEnabled:
		$StateMenu.tooltip_text = tooltipText
	else:
		$StateMenu.tooltip_text = ""
	
	# if HUD.commandNodesShown:
	for child in $CommandContainer.get_children():
		child.queue_free()
	for c in commandQueue.commandList:
		var node : ColorRect = commandNode.instantiate()
		if c.getType() != "move":
			node.color = "#FFFFFF"
		$CommandContainer.add_child(node)
	
	# run this logic once every 6 process (render) frames
	if Engine.get_process_frames() % 6 == 0:
		_lookAround()


	match currentAction:
		Actions.IDLE:
			sprites.play("idle", agentSpeed)
			if commandQueue.commandList.size() > 0:
				await commandQueue.commandList[0].run(self)
			
			# what should I do? think every 2 frames
			elif Engine.get_process_frames() % 2 == 0:
				match job:
					# Jobs.NOTHING:
						# nothing happens
					
					Jobs.MINING:
						# find next tile if command queue empty
						print("I'm a miner")
						if not sitesToMine.nextSite(self):
							print("I couldn't find any tile to mine")
							job = Jobs.NOTHING
				
				# random movement on map
				if HUD.idleMoveEnabled and randf() < 0.005:
					currentAction = Actions.MOVING
					await _moveToNeighbor()
				
				if randf() < 0.05:
					_decideWhatToDo()
				
			# reached end of current command
			currentAction = Actions.IDLE
			
		Actions.MOVING:
			sprites.play("walk", agentSpeed)
		
		Actions.MINING:
			sprites.play("mine", 1.0)

func _decideWhatToDo():
	# logic to pick a random job
	job = Jobs.MINING
		

func _on_state_menu_item_selected(index):
	# user selected follow on dwarf menu
	if (index == 0):
		world.cameraFollow(self)
	elif (index == 1):
		self.queue_free()

func _moveToNeighbor():
	var neighborTiles : Array[Tile] = pathfinder.findOpenNeighbors(coordinates)
	if (neighborTiles.size() > 0):
		var chosenTile : Tile = \
		neighborTiles[randi_range(0, neighborTiles.size()-1)]
		await _visuallyMoveToCoordinates(chosenTile.coordinates)

# called when entity moves to a new tile
func _visuallyMoveToCoordinates(tileCoords : Vector2i):
	var nextTile : Tile = tiles.getTileAt(tileCoords)
	var singleTween = create_tween()
	var curMoveCost : float = nextTile.movementCost * 1/agentSpeed
	if pathfinder.isDiagNeighbor(coordinates, tileCoords):
		curMoveCost *= 1.2
	
	# change direction entity is facing
	if(sprites.flip_h):
		if tileCoords.x > coordinates.x:
			sprites.flip_h = false
	else:
		if tileCoords.x < coordinates.x:
			sprites.flip_h = true
	
	# tweening world position instead of tile coordinates
	singleTween.tween_property(self, "position", nextTile.position, curMoveCost)
	await singleTween.finished
	coordinates = tileCoords
	
func _lookAround():
	var radius := 1
	var xCoord : int = coordinates.x-radius
	var yCoord : int = coordinates.y-radius
	# has a square field of knowledge, in the future this should be a raycast thing
	while xCoord <= coordinates.x+radius:
		var tempY := yCoord
		while tempY <= coordinates.y+radius:
			var tile : Tile = tiles.getTileAt(Vector2i(xCoord,tempY))
			if tile.orderedToMine:
				commandQueue.order(Command.Mine.new(tile))
			tempY+=1
		xCoord+=1

# handles movement to new location based on path from global Pathfinder
func moveTo(moveCommand : Command) -> bool:
	while moveCommand and not moveCommand.targetCoordinates == coordinates:
		var targetCoordinates : Vector2i = moveCommand.targetCoordinates
		
		var path : Array[Vector2i] = \
		pathfinder.findPathTo(targetCoordinates, coordinates)
		
		# return false if tile not reachable
		if path.is_empty():
			print(name+" now can't find path to location")
			return false
		
		var tileCoords : Vector2i = path[1]
		await _visuallyMoveToCoordinates(tileCoords)
		
		# if the command was deleted, for some reason setting it to idle works
		if not moveCommand:
			currentAction = Actions.IDLE
			return true
	
	return true

# Turn grid coordinates -> world/Game coordinates * gridSize
func mapToWorld(coords: Vector2i) -> Vector2:
	return Vector2(coords.x * gridSize, coords.y * gridSize)

func startMining(tile : Tile) -> bool:
	var wasInterrupted = false
	
	if(sprites.flip_h):
		if tile.coordinates.x > coordinates.x:
			sprites.flip_h = false
	else:
		if tile.coordinates.x < coordinates.x:
			sprites.flip_h = true
	
	while not (tile.traversable or wasInterrupted): # hehe demorgan
		await get_tree().create_timer(0.55).timeout
		tile.mine()
		
	if wasInterrupted:
		return false
	return true


class CommandQueue:
	var commandList : Array[Command] = []
	var entity : Dwarf
	
	func _init(_entity: Dwarf):
		entity = _entity
	
	func _isCommandTypeInQueue(command: Command) -> bool:
		for c in commandList:
			if c.getType() == command.getType():
				return true
		return false
	
	func order(command: Command) -> void:
		# current implementation, move commands can stack
#		if _isCommandTypeInQueue(command):
#			print(entity.name + " is already " + command.getType())
#		else:

		# is this a valid command for the entity? Usually true
		if command.valid(entity):
			commandList.append(command)
	
	func nextCommand() -> Command:
		return commandList.pop_front()
	
	func clear() -> void:
		for c in commandList:
			c.queue_free()
		commandList.clear()
