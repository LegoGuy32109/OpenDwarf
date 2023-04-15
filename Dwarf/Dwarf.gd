extends Node2D
class_name Dwarf

enum STATES {IDLE, MINING, MOVING}
enum JOBS {NOTHING, MINING}

var job : int = JOBS.NOTHING
var state : int = STATES.IDLE
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
	
	# giving code smell 😝 might rename state to 'current_action'
	match state:
		STATES.IDLE:
			sprites.play("idle", agentSpeed)
			if commandQueue.commandList.size() > 0:
				# eventually this will just .complete() each command instead of this if elif chain
				if commandQueue.commandList[0] is Move:
					state = STATES.MOVING
					
					if await moveTo(commandQueue.commandList[0].desiredLocation):
						commandQueue.nextCommand()
					else:
						print("My move failed")
						commandQueue.nextCommand()
				
				elif commandQueue.commandList[0] is Mine:
					state = STATES.MINING
					
					var siteTile : Tile = commandQueue.commandList[0].site.tile
					if await mineTile(siteTile):
						sitesToMine.removeSite(siteTile)
						commandQueue.nextCommand()
					else:
						print("My mine failed")
						commandQueue.nextCommand()
				
				elif commandQueue.commandList[0] is Command:
					print("Huh?")
			
			elif job != JOBS.NOTHING:
				match job:
					JOBS.MINING:
						if sitesToMine.is_empty():
							job = JOBS.NOTHING
							print("No tiles to mine ig")
						
						var returnObj = sitesToMine.nextSite(coordinates)
						if returnObj:
							returnObj.site.dwarvesCurrentlyMining.append(self)
							commandQueue.order(Move.new(returnObj.location))
							commandQueue.order(Mine.new(returnObj.site))
						else:
							job = JOBS.NOTHING
							print("can't reach any tile to mine")
						
			# Idle movement
			elif HUD.idleMoveEnabled and randf() < 0.005:
				state = STATES.MOVING
				await _moveToNeighbor()
		
			# reached end of current command
			state = STATES.IDLE
			
		STATES.MOVING:
			sprites.play("walk", agentSpeed)
		
		STATES.MINING:
			sprites.play("mine", 1.0)



func mineTile(tile : Tile) -> bool:
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

func _moveToNeighbor():
	var neighborTiles : Array[Tile] = pathfinder.findOpenNeighbors(coordinates)
	if (neighborTiles.size() > 0):
		var chosenTile : Tile = \
		neighborTiles[randi_range(0, neighborTiles.size()-1)]
		await moveTo(chosenTile.coordinates)

# handles visual movement to new location based on path from global Pathfinder
func moveTo(newCoordinates : Vector2i) -> bool:
	while not newCoordinates == coordinates:
		
		# interrupt movement when move command changed
		if not commandQueue.commandList.is_empty():
			var curCommandDesLoc : Vector2i = commandQueue.commandList[0].desiredLocation
			if(newCoordinates != curCommandDesLoc):
				newCoordinates = curCommandDesLoc
		
		var path : Array[Vector2i] = \
		pathfinder.findPathTo(newCoordinates, coordinates)
		
		# return false if tile not reachable
		if path.is_empty():
			print(name+" now can't find path to location")
			return false
		
		var tileCoords : Vector2i = path[1]
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

	return true

# Turn grid coordinates -> world/Game coordinates * gridSize
func mapToWorld(coords: Vector2i) -> Vector2:
	return Vector2(coords.x * gridSize, coords.y * gridSize)

func _on_state_menu_item_selected(index):
	# user selected follow on dwarf menu
	if (index == 0):
		world.cameraFollow(self)
	elif (index == 1):
		self.queue_free()

# this will grow more complex
class CommandQueue:
	var commandList : Array[Command] = []
	var entity : Dwarf
	
	func _init(_entity: Dwarf):
		entity = _entity
	
	func order(command: Command) -> void:
		if _isCommandTypeInQueue(command):
			print(entity.name + " is already moving")
		else:
			commandList.append(command)
	
	func _isCommandTypeInQueue(command: Command) -> bool:
		#Command will be a abstract class eventually, currently I'm only letting one in at a time
		for c in commandList:
			if c.getType() == command.getType():
				return true
		return false
		
	func nextCommand() -> Command:
		return commandList.pop_front()
	
	func clear() -> void:
		commandList.clear()
	
class Command:
	func getType()->String:
		var cType := "command"
		if self is Mine:
			cType = "mine"
		if self is Move:
			cType = "move"
		return cType

class Move extends Command:
	var desiredLocation: Vector2i
	func _init(coordinates: Vector2i):
		desiredLocation = coordinates

class Mine extends Command:
	var site : SitesToMine.MineSite
	func _init(_site : SitesToMine.MineSite):
		site = _site
