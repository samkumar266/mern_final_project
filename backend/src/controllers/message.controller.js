import User from "../models/user.model.js";
import Message from "../models/message.model.js";

import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io } from "../lib/socket.js";
import Notification from "../models/notification.model.js";
import Media from "../models/media.model.js";
import Conversation from "../models/conversation.model.js";

export const getUsersForSidebar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const filteredUsers = await User.find({ _id: { $ne: loggedInUserId } }).select("-password");

    res.status(200).json(filteredUsers);
  } catch (error) {
    console.error("Error in getUsersForSidebar: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { id: userToChatId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    });

    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { text, image } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    let imageUrl;
    let publicId;

    if (image) {
      // Upload base64 image to Cloudinary
      const uploadResponse = await cloudinary.uploader.upload(image);
      imageUrl = uploadResponse.secure_url;
      publicId = uploadResponse.public_id;
    }

    // Save the message
    const newMessage = new Message({
      senderId,
      receiverId,
      text,
      image: imageUrl,
    });

    await newMessage.save();

    // Save media metadata if there was an image
    if (imageUrl) {
      await Media.create({
        url: imageUrl,
        uploadedBy: senderId,
        messageId: newMessage._id,
        publicId,
        mediaType: "image",
      });
    }
    // --- Conversation logic start ---
    // Find existing conversation between these two users (both members must be in array)
    let conversation = await Conversation.findOne({
      members: { $all: [senderId, receiverId] },
    });

    // If no conversation found, create new
    if (!conversation) {
      conversation = new Conversation({
        members: [senderId, receiverId],
        lastMessage: text || (imageUrl ? "Image" : ""),
      });
    } else {
      // Update last message and timestamp
      conversation.lastMessage = text || (imageUrl ? "Image" : "");
      conversation.updatedAt = Date.now();
    }

    await conversation.save();
    // --- Conversation logic end ---

    // 🔄 Emit via Socket.IO if receiver is online
    const receiverSocketId = getReceiverSocketId(receiverId);

    // 🔔 Create a notification for the receiver
    const notification = await Notification.create({
      user: receiverId,
      type: "message",
      content: `New message from ${req.user.fullName}`,
    });


    // Emit notification if user is online
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newNotification", notification);
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const conversations = await Conversation.find({
      members: userId,
    })
      .populate("members", "-password")
      .sort({ updatedAt: -1 });

    res.status(200).json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

