extends Node2D

# in pixels
const TILE_SIZE := Vector2i(64,64)
# in tiles
const CHUNK_SIZE := Vector2i(64,64)

var loadedChunks: Array[Vector2i] = []

var moisture = FastNoiseLite.new()
var temperature = FastNoiseLite.new()
var altitude = FastNoiseLite.new()

@onready var player = %Entity

func _ready() -> void:
	moisture.seed = randi()
	temperature.seed = randi()
	altitude.seed = randi()
	altitude.frequency = 0.01

func _process(_delta: float) -> void:
	# if Engine.get_process_frames() % 3 == 0:
	var playerPosInWorld = Vector2i(player.position / Vector2(TILE_SIZE))
	generate_chunk(playerPosInWorld)
	unload_distant_chunks(playerPosInWorld)
	
func getDistance(p1: Vector2, p2: Vector2):
	var difference = p1-p2
	return sqrt(difference.x ** 2 + difference.y ** 2)

func generate_chunk(pos: Vector2i) -> void:
	var noiseRange := 5
	
	if pos not in loadedChunks:
		for x in range(CHUNK_SIZE.x):
			for y in range(CHUNK_SIZE.y):
				var cordInWord := pos + Vector2i(x, y) - CHUNK_SIZE/2
				var cellAlreadyExists = self.get_node_or_null( "TILE%s" % str(cordInWord) )
				if !cellAlreadyExists:
					var moist = moisture.get_noise_2d(
						pos.x - (TILE_SIZE.x / 2) + x, pos.y - (TILE_SIZE.y / 2) + y
					) * noiseRange 
					var temp = temperature.get_noise_2d(
						pos.x - (TILE_SIZE.x / 2) + x, pos.y - (TILE_SIZE.y / 2) + y
					) * noiseRange
					var alt = altitude.get_noise_2d(
						pos.x - (TILE_SIZE.x / 2) + x, pos.y - (TILE_SIZE.y / 2) + y
					) * noiseRange
					
					# create tile
					var cell = ColorRect.new()
					cell.position = cordInWord * TILE_SIZE
					cell.custom_minimum_size = TILE_SIZE
					cell.position = cell.position - Vector2(TILE_SIZE/2)
					cell.color = Color(moist, temp, alt)
					cell.name = "TILE%s" % str(cordInWord)
					
					self.add_child(cell)
		
		loadedChunks.append(pos)

func unload_distant_chunks(fromPos: Vector2i) -> void:
	var unloadDistance = (CHUNK_SIZE.x * 2) + 1
	
	for chunk in loadedChunks:
		var distanceToPos = getDistance(chunk, fromPos)
		if distanceToPos > unloadDistance:
			clear_chunk(chunk)

func clear_chunk(pos: Vector2i) -> void:
	for x in range(CHUNK_SIZE.x):
		for y in range(CHUNK_SIZE.y):
			var cordInWord := pos + Vector2i(x, y) - CHUNK_SIZE/2
			var nodeToDelete = self.get_node_or_null( "TILE%s" % str(cordInWord) )
			if(nodeToDelete):
				nodeToDelete.queue_free()

	loadedChunks.erase(pos)