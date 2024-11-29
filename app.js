const express = require('express')
const uWS = require('uWebSockets.js')
const bodyParser = require('body-parser')
const mongoose = require('mongoose')
const Chat = require('./models/Chat')
const Friends = require('./models/Friends')
const Location = require('./models/Location')
const Rooms = require('./models/Rooms')
const Connection = require('./db')
const app = express()
const http = require('http')
const server = http.createServer(app) // HTTP server for Express
const wsApp = uWS.App() // WebSocket server
const {requireAuth, getAuth, clerkMiddleware} = require('@clerk/express')
const {createClerkClient} = require('@clerk/backend')
const dotenv = require('dotenv')

dotenv.config()

Connection() // Establish database connection

// Setup middleware
app.use(express.json())
app.use(bodyParser.json())
app.use(clerkMiddleware())

// WebSocket room management
const rooms = {} // Store WebSocket clients by room

const clerkClient = createClerkClient({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY
})

app.get('/user/:userId', async (req, res) =>
{
    try
    {
        const userId = req.params.userId
        const user = await clerkClient.users.getUser(userId) // Get user from Clerk
        res.json({imageUrl: user.imageUrl || null})
    } catch (error)
    {
        console.error('Error fetching user:', error)
        res.status(500).send('Error fetching user')
    }
})

// Fetch older messages with pagination (by timestamp or message ID)
app.get('/messages/:roomId', async (req, res) =>
{
    try
    {
        const {roomId} = req.params  // Room ID
        const {before, limit = 20} = req.query  // Timestamp or message ID to fetch messages before it
        const userId = req.auth.userId  // Current authenticated user

        // Validate the 'before' parameter to check if it's a valid timestamp (number)
        let filter = {}
        if (before)
        {
            const beforeTimestamp = Number(before)  // Convert to a number

            // Check if it's a valid timestamp (not NaN)
            if (!isNaN(beforeTimestamp))
            {
                const beforeDate = new Date(beforeTimestamp)  // Convert timestamp to Date
                filter = {'createdAt': {$lt: beforeDate}}
            } else
            {
                console.error('Invalid timestamp format for before:', before)
            }
        }

        // Fetch messages for the room, sorting by createdAt in descending order (newest first)
        const messages = await Chat.find({'room.roomId': roomId, ...filter})
            .sort({createdAt: -1})  // Sort messages by descending createdAt
            .limit(Number(limit))  // Apply the limit
            .exec()

        // Send the messages to the client, marking if they've been read by the user
        const formattedMessages = messages.reverse().map(msg => ({
            ...msg.toObject(),
            readByUser: msg.message.readBy?.includes(userId),  // Check if the user has read this message
        }))

        res.json({messages: formattedMessages})
    } catch (error)
    {
        console.error('Error fetching messages:', error)
        res.status(500).send('Error fetching messages')
    }
})

// save users location
app.post('/user/location', async (req, res) =>
{
    const {userId, latitude, longitude} = req.body


    try
    {
        let location = await Location.findOne({userId})

        if (!location)
        {
            location = new Location({
                userId,
                latitude,
                longitude
            })

            await location.save()
            return res.status(200).json({message: 'Location saved successfully'})
        }

        // check if location already the same
        if (location.latitude !== latitude && location.longitude !== longitude)
        {
            location.latitude = latitude
            location.longitude = longitude
            await location.save()

            return res.status(200).json({message: 'Location saved successfully'})
        }

        res.status(200).json({message: 'Location already saved'})
    } catch (error)
    {
        console.error('Error saving location:', error)
        res.status(500).send('Error saving location')
    }
})

// get friends location from mass userIds
app.post('/friends/getInfo', async (req, res) =>
{
    const {userIds} = req.body

    try
    {
        let locations = await Location.find({userId: {$in: userIds}})

        locations = locations.map(location => ({
            userId: location.userId,
            coords: {
                latitude: location.latitude,
                longitude: location.longitude
            }
        }))

        res.json({locations})
    } catch (error)
    {
        console.error('Error fetching friends location:', error)
        res.status(500).send('Error fetching friends location')
    }
})

app.get('/friends', async (req, res) =>
{
    try
    {
        const userId = req.auth.userId // Assuming Clerk middleware has added `userId` to the `req.auth` object

        // Find all friends for the authenticated user from the Friends collection
        const friendships = await Friends.find({
            $or: [
                {userId: userId},  // Find all documents where the user is the first party
                {friendId: userId}  // or the second party
            ]
        })

        if (friendships.length === 0)
        {
            return res.json({friends: []})
        }

        // Extract the unique user IDs for friends
        const friendIds = friendships.map(friendship =>
            friendship.userId === userId ? friendship.friendId : friendship.userId
        )

        // Fetch user details for each friend from Clerk (you could also use MongoDB if you store user details in DB)
        const users = await clerkClient.users.getUserList({userId: friendIds})

        // Prepare the friends list
        let friends = Object.values(users.data).map(async (user) =>
        {
            const roomId = await Rooms.findOne({type: 'single', participants: {$all: [userId, user.id]}})
            const friendId = await user.id
            const username = await user.username
            const imageUrl = await user.imageUrl || null

            return {
                roomId: roomId._id,
                userId: friendId,
                username,
                imageUrl
            }
        })

        friends = await Promise.all(friends)

        res.json({friends: friends})
    } catch (error)
    {
        console.error('Error fetching friends:', error)
        res.status(500).send('Error fetching friends')
    }
})

app.post('/friends/add', async (req, res) =>
{
    const {userId, friendUserId} = req.body

    if (!userId)
    {
        console.log('Error: userId are required')
        return res.status(400).json({message: 'userId are required'})
    }

    try
    {
        const friend = await clerkClient.users.getUser(friendUserId)

        if (!friend || friend.length === 0)
        {
            return res.status(404).json({message: 'User not found in Clerk'})
        }

        // Check if the user is trying to add themselves
        if (friend.id === userId)
        {
            return res.status(400).json({message: 'You cannot add yourself as a friend'})
        }

        // Check if they are already friends
        const existingFriendship = await Friends.findOne({
            $or: [
                {userId, friendId: friend.id},
                {userId: friend.id, friendId: userId}
            ]
        })

        if (existingFriendship)
        {
            console.log('Error: Users are already friends')
            return res.status(400).json({message: 'You are already friends'})
        }

        // Add the friend relationship in the database
        const newFriendship = new Friends({
            userId,
            friendId: friend.id,
            status: 'pending',
            isOnline: false,
            lastStatusUpdate: new Date()
        })

        await newFriendship.save()

        const newRoom = new Rooms({
            type: 'single',
            participants: [userId, friend.id]
        })

        await newRoom.save()

        // Respond with success
        res.status(200).json({message: 'Friend added successfully'})
    } catch (error)
    {
        // Log the error and stack trace
        console.error('Error occurred while adding friend:', error)
        console.error(error.stack)  // Log the full stack trace

        // Respond with a generic error message
        res.status(500).json({message: 'Server error while adding friend'})
    }
})

app.post('/users/search', async (req, res) =>
{
    const {username} = req.body // The username to search for

    if (!username)
    {
        return res.status(400).json({message: 'Username is required'})
    }

    try
    {
        // Search for the user by their username
        const user = await clerkClient.users.getUserList({query: username})

        if (!user)
        {
            return res.status(404).json({message: 'User not found'})
        }

        res.status(200).json({userId: user.data[0].id})
    } catch (error)
    {
        console.error(error)
        res.status(500).json({message: 'Server error'})
    }
})

app.post('/participants', async (req, res) =>
{
    const {room} = req.body
    try
    {
        console.log('Fetching participants for room:', room)
        let participantUserIds = await Rooms.findOne({_id: room})
        participantUserIds = participantUserIds.participants

        let users = await clerkClient.users.getUserList({userId: participantUserIds})
        users = Object.values(users.data).map(user => ({
            userId: user.id,
            username: user.username,
            imageUrl: user.imageUrl || null
        }))

        res.json({users})
    } catch (error)
    {
        console.error('Error fetching participants:', error)
        res.status(500).send('Error fetching participants')
    }
})

app.post('/addParticipant', async (req, res) =>
{
    const {room, newUserId} = req.body
    console.log(`Adding participant ${newUserId} to room ${room}`)

    // Ensure the new user is added to the room in the rooms object
    if (rooms[room])
    {
        // Add the new user to all connected WebSocket clients
        const newWs = await getWebSocketForUser(newUserId)  // Implement this method to fetch WebSocket connection
        rooms[room].push(newWs)

        // Send a notification to the room about the new user
        rooms[room].forEach(client =>
        {
            client.send(JSON.stringify({
                type: 'system',
                message: `${newUserId} has joined the chat`
            }))
        })

        res.status(200).json({success: true})
    } else
    {
        res.status(404).json({error: 'Room not found'})
    }
})

app.post('/deleteUser', async (req, res) =>
{
    const {userId} = req.body
    console.log(`Deleting user ${userId}`)

    // Find all rooms where the user is a participant
    const rooms = await Rooms.find({participants: userId})

    // Remove the user from all rooms
    rooms.forEach(async room =>
    {
        room.participants = room.participants.filter(id => id !== userId)
        await room.save()
    })

    // delete from clerk
    await clerkClient.users.deleteUser(userId)

    res.status(200).json({success: true})
})

// API endpoint for posting a message
app.post('/send', async (req, res) =>
{
    const {room, userId, username, text, messageType, roomType, participants} = req.body

    console.log("Received message: ", {room, userId, username, text, messageType})

    if (!room || !userId || !text || !roomType)
    {
        return res.status(400).json({error: 'Invalid input: room, userId, text and roomType are required'})
    }

    if (roomType === 'single' && !participants)
    {
        return res.status(400).json({error: 'Invalid input: participants are required for single chat'})
    }

    if (roomType === 'group' && !participants)
    {
        return res.status(400).json({error: 'Invalid input: participants are required for group chat'})
    }

    if (roomType === 'group' && participants.length < 2)
    {
        return res.status(400).json({error: 'Invalid input: at least two participants are required for group chat'})
    }

    try
    {
        // Save the message to MongoDB
        const newMessage = new Chat({
            user: {userId, username},
            message: {text, messageType, readBy: []},
            room: {roomId: room, type: roomType, userIds: [participants]}
        })
        await newMessage.save()

        console.log('Message saved:', newMessage)

        // Broadcast the message to all clients in the same room via WebSocket
        if (rooms[room])
        {
            rooms[room].forEach(client =>
            {
                if (client.userId && client.userId !== userId)
                {  // Check if userId exists
                    client.send(JSON.stringify({
                        type: 'message',
                        userId,
                        username,
                        text,
                        messageType,
                        _id: newMessage._id, // Ensure this is sent
                        readBy: newMessage.message.readBy,
                        sentByClient: false
                    }))

                    console.log('Message sent to client:', client.userId)
                }
            })
        }

        // Respond with a success message and the message ID
        res.status(200).json({message: 'Message sent successfully', _id: newMessage._id})
    } catch (err)
    {
        console.error('Error sending message:', err)
        res.status(500).json({error: 'Failed to send message'})
    }
})

app.post('/read', async (req, res) =>
{
    const {messageId, userId, roomId} = req.body
    try
    {
        console.log("Received read request: ", {messageId, userId, roomId})
        const message = await Chat.findById(messageId)
        if (!message)
        {
            return res.status(404).json({error: 'Message not found'})
        }

        if (message && !message.message.readBy.includes(userId))
        {
            message.message.readBy.push(userId)
            await message.save()
        }

        // Notify WebSocket clients in the room
        if (rooms[roomId])
        {
            rooms[roomId].forEach(client =>
            {
                client.send(JSON.stringify({
                    type: 'read',
                    messageId,
                    userId
                }))
            })
        }

        // Return success response
        res.status(200).json({success: true})
    } catch (error)
    {
        console.error('Error marking message as read:', error)
        res.status(500).json({error: 'Failed to mark message as read'})
    }
})

const sendPushNotification = (userId, message) =>
{
    // This is a hypothetical function that sends a push notification
    // to a user based on their user ID
    console.log(`Sending push notification to user ${userId}:`, message)
}

// WebSocket logic using uWebSockets.js
wsApp.ws('/chat', {
    open: (ws) =>
    {
        console.log('A new client connected')
    },

    message: async (ws, message) =>
    {
        const parsedMessage = JSON.parse(Buffer.from(message).toString())
        const {type, room, userId, username, text, messageType, messageId} = parsedMessage

        if (type === 'join')
        {
            if (!rooms[room])
            {
                rooms[room] = []
            }

            ws.userId = userId
            rooms[room].push(ws)
            console.log(`${userId} joined room ${room}`)

            // Fetch and send the most recent messages
            const messages = await Chat.find({'room.roomId': room})
                .sort({createdAt: -1})  // Sort by newest messages first
                .limit(6)  // Adjust limit as needed

            ws.send(JSON.stringify({
                type: 'history',
                messages: messages.reverse().map(msg => ({
                    ...msg.toObject(),
                    readByUser: msg.message.readBy.includes(userId),
                })),
            }))
        }

        if (type === 'message')
        {
            if (!text || !room)
            {
                console.error('Invalid message:', parsedMessage)
                return
            }

            // Save the message to MongoDB
            const newMessage = new Chat({
                room: {
                    userId,
                    username
                },
                message: {
                    text,
                    messageType,
                    readBy: []
                },
                room: {
                    roomId: room,
                    type: roomType,
                    userIds: [participants]
                }
            })
            await newMessage.save()

            // Broadcast the message to all clients in the room
            if (rooms[room])
            {
                rooms[room].forEach(client =>
                {
                    if (client.userId !== userId)
                    {  // Avoid sending message to the sender
                        try
                        {
                            client.send(JSON.stringify({
                                type: 'message',
                                userId,
                                username,
                                text,
                                messageType,
                                _id: newMessage._id,
                                readBy: newMessage.readBy,
                                sentByClient: false,
                            }))
                        } catch (error)
                        {
                            console.error(`Failed to send message to client ${client.userId}:`, error)
                        }
                    }
                })
            }
        }

        if (type === 'read')
        {
            // Update the read status in MongoDB
            const message = await Chat.findById(messageId)
            if (!message.readBy.includes(userId))
            {
                message.readBy.push(userId)
                await message.save()
            }

            // Notify WebSocket clients in the room
            if (rooms[room])
            {
                rooms[room].forEach(client =>
                {
                    client.send(JSON.stringify({
                        type: 'read',
                        messageId,
                        userId
                    }))
                })
            }
        }

        if (type === 'friend')
        {

        }
    },

    close: (ws) =>
    {
        console.log('A client disconnected')
        // Clean up the client from all rooms
        for (let room in rooms)
        {
            rooms[room] = rooms[room].filter(client => client !== ws)
        }
    }
})

// Start HTTP server for Express API
server.listen(80, '0.0.0.0', () =>
{
    console.log('Express API server running')
})

// Start WebSocket server for real-time chat
wsApp.listen(8080, '0.0.0.0', (token) =>
{
    if (token)
    {
        console.log('uWebSockets WebSocket server running')
    } else
    {
        console.log('Failed to start WebSocket server')
    }
})
