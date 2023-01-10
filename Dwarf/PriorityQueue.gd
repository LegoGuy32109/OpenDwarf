extends Node
# if I need to upgrade this check here: 
# https://www.geeksforgeeks.org/priority-queue-set-1-introduction/
class_name PriorityQueue
# the lower the priority number the quicker recieved
class DictionaryType:
	var priority : int
	var thing # could be anything oooo

	func _init(t, p: int):
		priority = p
		thing = t

var queue: Array[DictionaryType]

func _init():
	queue = []

func put(thing, priority : int) -> void:
	var dict : DictionaryType = DictionaryType.new(thing, priority)
	queue.append(dict)
	
func peek() -> DictionaryType:
	var nextOff : DictionaryType = null
	for item in queue:
#                                changing < to > fixed everything!!!!
		if nextOff == null or nextOff.priority > item.priority:
			nextOff = item
	return nextOff

func dequeue():
	if queue.size() == 0:
		return null
	var boutToLeave : DictionaryType = peek()
	queue.erase(boutToLeave)
	return boutToLeave.thing
	
