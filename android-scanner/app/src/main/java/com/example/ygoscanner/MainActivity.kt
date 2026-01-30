package com.example.ygoscanner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Patterns
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var serverInput: EditText
    private lateinit var startButton: Button
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var webSocket: WebSocket? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        previewView = findViewById(R.id.previewView)
        statusText = findViewById(R.id.statusText)
        serverInput = findViewById(R.id.serverInput)
        startButton = findViewById(R.id.startButton)

        startButton.setOnClickListener {
            if (hasCameraPermission()) {
                connectAndStart()
            } else {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1001)
            }
        }
    }

    private fun connectAndStart() {
        val target = serverInput.text.toString().trim()
        if (target.isEmpty()) {
            statusText.text = "Status: Bitte PC IP:Port eingeben"
            return
        }
        val wsUrl = "ws://$target"
        val client = OkHttpClient()
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {})
        statusText.text = "Status: verbunden ($wsUrl)"
        startCamera()
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder().build().also { imageAnalysis ->
                imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage != null) {
                        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                        recognizer.process(image)
                            .addOnSuccessListener { visionText ->
                                val payload = parseCard(visionText.text)
                                if (payload != null) {
                                    sendCard(payload)
                                    statusText.post { statusText.text = "Status: Scan erfolgreich" }
                                }
                            }
                            .addOnCompleteListener {
                                imageProxy.close()
                            }
                    } else {
                        imageProxy.close()
                    }
                }
            }

            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(this))
    }

    private fun parseCard(text: String): CardPayload? {
        val passcode = Regex("\\b\\d{4,12}\\b").find(text)?.value ?: ""
        val lines = text.split("\n").map { it.trim() }.filter { it.length >= 3 }
        val name = lines.firstOrNull { !it.matches(Regex("\\d+")) } ?: ""
        if (passcode.isEmpty() && name.isEmpty()) return null
        return CardPayload(deName = name, enName = name, passcode = passcode)
    }

    private fun sendCard(card: CardPayload) {
        val obj = JSONObject()
        obj.put("type", "scan")
        obj.put("card", JSONObject().apply {
            put("de_name", card.deName)
            put("en_name", card.enName)
            put("passcode", card.passcode)
        })
        webSocket?.send(obj.toString())
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
}

data class CardPayload(val deName: String, val enName: String, val passcode: String)
